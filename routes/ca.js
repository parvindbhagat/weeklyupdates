/**
 * routes/ca.js
 * ─────────────────────────────────────────────────────────────────────────
 * Express router mounted at /ca .
 *
 * Endpoints:
 *
 *  REPORTS
 *  POST   /reports/import          Upload monthly JSON → save to MongoDB
 *  GET    /reports                 List all editions (meta only)
 *  GET    /reports/:editionKey     Full report for dashboard (with client flags)
 *  PATCH  /reports/:editionKey/publish   Publish a draft
 *
 *  COMPANY DECISIONS (human-in-loop)
 *  PATCH  /reports/:editionKey/companies/:companyId/approve
 *  PATCH  /reports/:editionKey/companies/:companyId/reject
 *
 *  REJECTION STORE
 *  GET    /rejections              Active block-list
 *  DELETE /rejections/:id          Pardon a company
 *
 *  CLIENTS (SharePoint sync)
 *  GET    /clients                 List existing clients
 *  POST   /clients                 Add single client manually
 *  PATCH  /clients/sync            Bulk upsert from SharePoint payload
 *
 *  APOLLO ENRICHMENT
 *  GET    /reports/:editionKey/apollo-queue   Companies approved but not yet enriched
 *  PATCH  /reports/:editionKey/companies/:companyId/apollo  Write enrichment result
 *
 *  UTILITY
 *  GET    /prompt-context/:editionKey   Returns block-list JSON for Claude prompt
 * ─────────────────────────────────────────────────────────────────────────
 */

const express        = require('express');
const router         = express.Router();
const jsonbig        = express.json({ limit: '2mb' }); // for large report payloads
const CAReport       = require('../model/ca/report');
const RejectionStore = require('../model/ca/rejectionstore');
const Client         = require('../model/ca/clients');

// ── Middleware: verify Power Automate secure key ──────────────────────────
// Set IMPORT_SECRET_KEY in your .env file.
// Power Automate HTTP action must send:
//   Header → X-Import-Key: <your-secret>
//   Body   → the monthly JSON payload
//
// If the key is missing or wrong, the request is rejected with 401.
// This middleware is applied ONLY to POST /reports/import.
function verifyImportKey(req, res, next) {
  const secret     = process.env.IMPORT_SECRET_KEY;
  const incomingKey = req.headers['x-import-key'];

  if (!secret) {
    console.error('[CA import] IMPORT_SECRET_KEY is not set in environment');
    return res.status(500).json({ error: 'Server misconfiguration: import key not configured' });
  }

  if (!incomingKey || incomingKey !== secret) {
    console.warn('[CA import] Unauthorised attempt — bad or missing X-Import-Key');
    return res.status(401).json({ error: 'Unauthorised: invalid or missing import key' });
  }

  next();
}

// ── Middleware: resolve company subdoc across all sectors ─────────────────
async function resolveCompany(req, res, next) {
  const { editionKey, companyId } = req.params;
  const report = await CAReport.findOne({ editionKey });
  if (!report) return res.status(404).json({ error: 'Report edition not found' });

  let foundCompany = null;
  let foundSector  = null;

  for (const sector of report.sectors) {
    const co = sector.companies.id(companyId);
    if (co) { foundCompany = co; foundSector = sector; break; }
  }

  if (!foundCompany) return res.status(404).json({ error: 'Company not found in this edition' });

  req.report  = report;
  req.company = foundCompany;
  req.sector  = foundSector;
  next();
}

// ══════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════


/**
 * POST /ca/reports/import
 * ─────────────────────────────────────────────────────────────────────────
 * Called by Power Automate each month when a new report JSON is ready.
 *
 * Power Automate HTTP action config:
 *   Method:   POST
 *   URI:      https://chrysalis-hrd.yourdomain.com/ca/reports/import
 *   Headers:
 *     Content-Type : application/json
 *     X-Import-Key : <your IMPORT_SECRET_KEY from .env>
 *     X-Imported-By: power-automate            (optional, logged for audit)
 *     X-Source-File: chrysalis_hrd_data_2026_06.json  (optional, logged)
 *   Body:     the full monthly JSON (chrysalis_hrd_data_YYYY_MM.json content)
 *
 * Steps:
 *  1. verifyImportKey middleware checks X-Import-Key header → 401 if wrong
 *  2. Derive editionKey from meta.edition ("May 2026" → "2026-05")
 *  3. Cross-check each company against ca_clients (flag isExistingClient)
 *  4. Skip companies that are in the active rejection block-list
 *  5. Upsert the report document into ca_reports collection
 * ─────────────────────────────────────────────────────────────────────────
 */
router.post('/reports/import', jsonbig, verifyImportKey, async (req, res) => {
  try {
    const json = req.body;
    if (!json?.meta?.edition) {
      return res.status(400).json({ error: 'Invalid JSON: missing meta.edition' });
    }

    const editionKey   = deriveEditionKey(json.meta.edition);
    const importedBy   = req.headers['x-imported-by']  || 'system';
    const sourceFile   = req.headers['x-source-file']  || '';

    // Fetch cross-reference data once
    const [blockList, existingClients] = await Promise.all([
      RejectionStore.getActiveBlockList(),
      Client.find({ isActive: true }).select('shortName normalisedName cuid').lean(),
    ]);

    const blockSet   = new Set(blockList.map((b) => b.normalisedName));
    const clientMap  = new Map(existingClients.map((c) => [c.normalisedName, c]));

    let skippedCount = 0;

    // Annotate companies in each sector
    const annotatedSectors = json.sectors.map((sector) => {
      const annotatedCompanies = [];

      sector.companies.forEach((co) => {
        const norm = normalise(co.company);

        // Skip if on rejection block-list
        if (blockSet.has(norm)) {
          skippedCount++;
          return;
        }

        // Flag if existing client
        const clientMatch = clientMap.get(norm);

        annotatedCompanies.push({
          ...co,
          status:           'pending',
          rejection_reason: '',
          apollo_enriched:  false,
          isExistingClient: !!clientMatch,
          clientCuid:       clientMatch?.cuid || null,
        });
      });

      return { ...sector, companies: annotatedCompanies };
    });

    // Upsert report
    const report = await CAReport.findOneAndUpdate(
      { editionKey },
      {
        $set: {
          editionKey,
          meta:         json.meta,
          overview:     json.overview,
          sectors:      annotatedSectors,
          reportStatus: 'draft',
          importedAt:   new Date(),
          importedBy,
          sourceFile,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      message:      'Report imported successfully',
      editionKey,
      _id:          report._id,
      totalSectors: report.sectors.length,
      totalCompanies: report.sectors.reduce((n, s) => n + s.companies.length, 0),
      skippedFromBlockList: skippedCount,
    });
  } catch (err) {
    console.error('[CA import]', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ca/reports
 * Returns all editions (meta + status only, no companies)
 */
router.get('/reports', async (req, res) => {
  try {
    const reports = await CAReport.find(
      {},
      { meta: 1, editionKey: 1, reportStatus: 1, importedAt: 1, publishedAt: 1, rejectedCompanyNames: 1 }
    )
      .sort({ editionKey: -1 })
      .lean();
    return res.json(reports);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ca/reports/:editionKey
 * Returns the full report document — used to hydrate the dashboard.
 */
router.get('/reports/:editionKey', async (req, res) => {
  try {
    const report = await CAReport.findOne({ editionKey: req.params.editionKey }).lean();
    if (!report) return res.status(404).json({ error: 'Edition not found' });
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/ca/reports/:editionKey/publish
 */
router.patch('/reports/:editionKey/publish', async (req, res) => {
  try {
    const report = await CAReport.findOneAndUpdate(
      { editionKey: req.params.editionKey },
      { $set: { reportStatus: 'published', publishedAt: new Date(), publishedBy: req.user?.username || 'admin' } },
      { new: true, select: 'editionKey reportStatus publishedAt' }
    );
    if (!report) return res.status(404).json({ error: 'Edition not found' });
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// COMPANY DECISIONS (human-in-loop)
// ══════════════════════════════════════════════════════════════════════════

/**
 * PATCH /ca/reports/:editionKey/companies/:companyId/approve
 * Body: { approvedBy: "string" }
 */
router.patch('/reports/:editionKey/companies/:companyId/approve', resolveCompany, async (req, res) => {
  try {
    const { approvedBy } = req.body;
    const co             = req.company;

    co.status      = 'approved';
    co.approved_by = req.user?.username || 'leadership';
    co.approved_at = new Date();
    co.rejection_reason = '';

    await req.report.save();
    return res.json({ company: co.company, status: 'approved', approved_at: co.approved_at });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/ca/reports/:editionKey/companies/:companyId/reject
 * Body: { rejection_reason: "string", rejectedBy: "string", neverShowAgain: bool, expires_at: ISO date }
 */
router.patch('/reports/:editionKey/companies/:companyId/reject', resolveCompany, async (req, res) => {
  try {
    const { rejection_reason, rejectedBy, neverShowAgain = false, expires_at = null } = req.body;

    if (!rejection_reason?.trim()) {
      return res.status(400).json({ error: 'rejection_reason is required' });
    }

    const co = req.company;
    co.status           = 'rejected';
    co.rejection_reason = rejection_reason.trim();
    co.rejected_by      = req.user?.username || 'leadership';
    co.rejected_at      = new Date();

    // Write to persistent block-list
    await RejectionStore.upsertRejection({
      company:              co.company,
      rejection_reason:     co.rejection_reason,
      rejected_by:          co.rejected_by,
      rejected_in_edition:  req.params.editionKey,
      neverShowAgain,
      expires_at: expires_at ? new Date(expires_at) : null,
    });

    await req.report.save();   // triggers pre-save to rebuild rejectedCompanyNames

    return res.json({
      company:          co.company,
      status:           'rejected',
      rejection_reason: co.rejection_reason,
      neverShowAgain,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// REJECTION STORE
// ══════════════════════════════════════════════════════════════════════════

/** GET /api/ca/rejections — active block-list */
router.get('/rejections', async (req, res) => {
  try {
    const list = await RejectionStore.getActiveBlockList();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/ca/rejections/:id — pardon a company */
router.delete('/rejections/:id', async (req, res) => {
  try {
    const doc = await RejectionStore.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false, pardonedAt: new Date(), pardonedBy: req.user?.username || 'admin' } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Rejection record not found' });
    return res.json({ message: `${doc.company} pardoned — will re-enter pool next month`, doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CLIENTS (SharePoint)
// ══════════════════════════════════════════════════════════════════════════

/** GET /api/ca/clients */
router.get('/clients', async (req, res) => {
  try {
    const { industry, search } = req.query;
    const filter = { isActive: true };
    if (industry) filter.industry = industry;
    if (search)   filter.$or = [
      { shortName:  { $regex: search, $options: 'i' } },
      { fullName:   { $regex: search, $options: 'i' } },
      { cuid:       { $regex: search, $options: 'i' } },
    ];
    const clients = await Client.find(filter).sort({ shortName: 1 }).lean();
    return res.json(clients);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/ca/clients — manual add */
router.post('/clients', async (req, res) => {
  try {
    const client = new Client(req.body);
    await client.save();
    return res.status(201).json(client);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'CUID already exists' });
    return res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /ca/clients/sync
 * Body: { records: [ { cuid, shortName, fullName, industry, spItemId }, ... ] }
 * Called by your SharePoint sync job / webhook.
 */
router.patch('/clients/sync', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required' });
    }
    const result = await Client.syncFromSharePoint(records);
    return res.json({
      message:  'Sync complete',
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// APOLLO ENRICHMENT
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ca/reports/:editionKey/apollo-queue
 * Returns companies that are approved but not yet enriched.
 */
router.get('/reports/:editionKey/apollo-queue', async (req, res) => {
  try {
    const report = await CAReport.findOne({ editionKey: req.params.editionKey }).lean();
    if (!report) return res.status(404).json({ error: 'Edition not found' });

    const queue = [];
    report.sectors.forEach((sector) => {
      sector.companies.forEach((co) => {
        if (co.status === 'approved' && !co.apollo_enriched) {
          queue.push({
            _id:           co._id,
            company:       co.company,
            primary_buyer: co.primary_buyer,
            subsector:     co.subsector,
            sector:        sector.name,
          });
        }
      });
    });

    return res.json({ editionKey: req.params.editionKey, total: queue.length, queue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/ca/reports/:editionKey/companies/:companyId/apollo
 * Body: { email, phone, linkedinUrl, confidenceScore }
 * Called by your Apollo.io enrichment job after resolving contacts.
 */
router.patch('/reports/:editionKey/companies/:companyId/apollo', resolveCompany, async (req, res) => {
  try {
    const { email, phone, linkedinUrl, confidenceScore } = req.body;
    const co = req.company;

    co.apollo_enriched = true;
    co.apollo_data     = { email, phone, linkedinUrl, confidenceScore, enrichedAt: new Date() };

    await req.report.save();
    return res.json({ company: co.company, apollo_enriched: true, apollo_data: co.apollo_data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ca/prompt-context/:editionKey
 * Returns a JSON payload the Claude prompt can read directly:
 *  - active rejection block-list (from RejectionStore)
 *  - existing client names (from ca_clients)
 * Use this as the data source in your monthly report generation prompt.
 */
router.get('/prompt-context/:editionKey', async (req, res) => {
  try {
    const [blockList, clients] = await Promise.all([
      RejectionStore.getActiveBlockList(),
      Client.find({ isActive: true }).select('shortName fullName cuid industry').lean(),
    ]);

    return res.json({
      generatedAt:  new Date().toISOString(),
      forEdition:   req.params.editionKey,
      blockList: blockList.map((b) => ({
        company:          b.company,
        rejection_reason: b.rejection_reason,
        rejected_in:      b.rejected_in_edition,
        neverShowAgain:   b.neverShowAgain,
        expires_at:       b.expires_at,
      })),
      existingClients: clients.map((c) => ({
        shortName: c.shortName,
        fullName:  c.fullName,
        cuid:      c.cuid,
        industry:  c.industry,
      })),
      promptInstructions: [
        'MANDATORY: Exclude ALL companies listed in blockList from every sector.',
        'FLAG companies whose shortName matches existingClients — set isExistingClient:true in their record.',
        'Do not remove existing clients from the list; flag them so leadership can review the relationship.',
        'Set status:"pending", rejection_reason:"", apollo_enriched:false on every company you generate.',
      ],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Helper (duplicated here to avoid circular dep) ─────────────────────────
function normalise(name = '') {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|inc|incorporated|llp|llc|plc|co|corp|corporation|india|group|holdings?)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveEditionKey(edition = '') {
  // "May 2026" → "2026-05",  "June 2026" → "2026-06"
  const months = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
                   july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
  const parts  = edition.toLowerCase().trim().split(/\s+/);
  const month  = months[parts[0]] || '00';
  const year   = parts[1] || new Date().getFullYear().toString();
  return `${year}-${month}`;
}

async function renderEditionPage(req, res) {
  const editionKey = req.params.editionKey;

  let data = null;
  if (editionKey) {
    data = await CAReport.findOne({ editionKey }).lean();
  }

  if (!data) {
    data = await CAReport.findOne({}).sort({ editionKey: -1 }).lean();
  }

  const editions = await CAReport.find(
    {},
    { editionKey: 1, 'meta.edition': 1 }
  )
    .sort({ editionKey: -1 })
    .limit(5)
    .lean();

  res.render('cahome', {
    title: 'Chrysalis CA Dashboard',
    reportdata: data || {},
    editions,
  });
}

router.get('/', renderEditionPage);
router.get('/:editionKey(\\d{4}-\\d{2})', renderEditionPage);

module.exports = router;
