/**
 * model/ca/clients.js
 * ─────────────────────────────────────────────────────────────────────────
 * Represents an EXISTING Chrysalis HRD client, sourced from the SharePoint
 * list.  This collection is the authoritative block-list for the CA report:
 * any company whose normalised name matches an existing client must be
 * excluded from the monthly intelligence report (or flagged as "existing").
 *
 * SharePoint list columns   →  MongoDB field
 * ──────────────────────────────────────────
 * Short Name                →  shortName
 * Full Name                 →  fullName
 * CUID                      →  cuid          (unique per client, your PK)
 * Industry                  →  industry
 *
 * Sync strategy: a scheduled job (or webhook) calls PATCH /api/ca/clients/sync
 * and upserts records by cuid.  Manual adds via POST /api/ca/clients are also
 * allowed (for clients not yet in SharePoint).
 * ─────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Sub-schema: Apollo.io enrichment snapshot ─────────────────────────────
const ApolloContactSchema = new Schema(
  {
    email:            { type: String, trim: true },
    phone:            { type: String, trim: true },
    linkedinUrl:      { type: String, trim: true },
    confidenceScore:  { type: Number, min: 0, max: 100 },
    enrichedAt:       { type: Date },
    enrichedBy:       { type: String, default: 'apollo.io' },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────────────
const ClientSchema = new Schema(
  {
    // ── Identity (from SharePoint) ────────────────────────────────────────
    cuid: {
      type:     Number,
      required: [true, 'CUID is required'],
      unique:   true,
      min:      [100000, 'CUID must be a 6-digit number'],
      index:    true,
      comment:  '6-digit unique client ID from SharePoint (your master PK)',
    },

    shortName: {
      type:     String,
      required: [true, 'Short name is required'],
      trim:     true,
      index:    true,
      comment:  'e.g. "HDFC Bank" — used for fuzzy matching in CA report',
    },

    fullName: {
      type:     String,
      required: [true, 'Full name is required'],
      trim:     true,
      comment:  'e.g. "HDFC Bank Limited"',
    },

    industry: {
      type:     String,
      trim:     true,
      comment:  'Industry as categorised in SharePoint (BFSI, IT, Pharma, etc.)',
    },

    // ── Normalised name for matching ──────────────────────────────────────
    // Stored lower-case, stripped of punctuation/legal suffixes.
    // Auto-computed on save.  Used to cross-check against CA report companies.
    normalisedName: {
      type:  String,
      index: true,
      comment: 'Auto-generated: lowercase, no Ltd/Inc/Pvt/LLP. Used for dedup matching.',
    },

    // ── SharePoint sync metadata ──────────────────────────────────────────
    spLastSyncedAt: {
      type:    Date,
      comment: 'Timestamp of last successful SharePoint sync for this record',
    },

    spItemId: {
      type:    String,
      trim:    true,
      comment: 'SharePoint list item ID — used for delta sync',
    },

    // ── Apollo contact (populated post-approval on CA report side) ────────
    apolloContact: {
      type:    ApolloContactSchema,
      default: null,
    },

    // ── Status flags ──────────────────────────────────────────────────────
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
      comment: 'Set false if client relationship ended; still kept for history',
    },

    notes: {
      type:    String,
      trim:    true,
      comment: 'Free-text notes from account team',
    },
  },
  {
    timestamps: true,               // adds createdAt, updatedAt
    collection:  'ca_clients',
  }
);

// ── Pre-save: compute normalisedName ──────────────────────────────────────
ClientSchema.pre('save', function (next) {
  if (this.isModified('shortName') || this.isNew) {
    this.normalisedName = normalise(this.shortName);
  }
  next();
});

// ── Pre-updateOne / findOneAndUpdate: keep normalisedName in sync ─────────
ClientSchema.pre(['updateOne', 'findOneAndUpdate'], function (next) {
  const update = this.getUpdate();
  const name   = update?.shortName || update?.$set?.shortName;
  if (name) {
    const set = update.$set || {};
    set.normalisedName = normalise(name);
    update.$set = set;
  }
  next();
});

// ── Static: check if a company name is an existing client ─────────────────
ClientSchema.statics.isExistingClient = async function (companyName) {
  const norm = normalise(companyName);
  const doc  = await this.findOne({ normalisedName: norm, isActive: true }).lean();
  return doc;                       // returns null if not found, document if found
};

// ── Static: bulk upsert from SharePoint sync payload ─────────────────────
ClientSchema.statics.syncFromSharePoint = async function (records) {
  const ops = records.map((r) => ({
    updateOne: {
      filter: { cuid: r.cuid.toUpperCase() },
      update: {
        $set: {
          cuid:           r.cuid.toUpperCase(),
          shortName:      r.shortName,
          fullName:       r.fullName,
          industry:       r.industry,
          normalisedName: normalise(r.shortName),
          spItemId:       r.spItemId,
          spLastSyncedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));
  return this.bulkWrite(ops, { ordered: false });
};

// ── Helper ─────────────────────────────────────────────────────────────────
function normalise(name = '') {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|inc|incorporated|llp|llc|plc|co|corp|corporation|india|group|holdings?)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = mongoose.model('Client', ClientSchema);
