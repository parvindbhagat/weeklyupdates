/**
 * models/ca/report.js
 * ─────────────────────────────────────────────────────────────────────────
 * One document per monthly report edition.
 * Mirrors the chrysalis_hrd_data_YYYY_MM.json schema exactly,
 * extended with human-in-loop fields on each company record.
 *
 * Collection:  ca_reports
 *
 * Design decisions:
 *  - Companies are EMBEDDED inside sectors (not a separate collection).
 *    Each company array has ~50 records × 6 sectors = ~300 subdocs per
 *    report. This is well within MongoDB's 16 MB document limit and lets
 *    the entire report load in one query for the dashboard.
 *  - A separate CACompanyStatus collection handles leadership decisions
 *    so that approval/rejection history survives across report editions.
 *  - rejectedCompanyNames is a denormalised set on this document so the
 *    next month's generation prompt can read it in one query.
 * ─────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ══════════════════════════════════════════════════════════════════════════
// Reusable sub-schemas
// ══════════════════════════════════════════════════════════════════════════

const MetricCardSchema = new Schema(
  {
    label: { type: String, required: true },
    value: { type: String, required: true },
    desc:  { type: String, required: true },
    color: { type: String, enum: ['red', 'yellow', 'blue', 'tri'], required: true },
  },
  { _id: false }
);

const InsightSchema = new Schema(
  {
    icon:  { type: String },
    title: { type: String, required: true },
    text:  { type: String, required: true },
  },
  { _id: false }
);

const ChroTimelineSchema = new Schema(
  {
    company: { type: String, required: true },
    role:    { type: String, required: true },  // "Name | Title"
    date:    { type: String, required: true },  // display string e.g. "Feb 2026"
    detail:  { type: String },
    color:   { type: String, enum: ['red', 'yellow', 'blue'], default: 'blue' },
  },
  { _id: false }
);

const Tier1TargetSchema = new Schema(
  {
    company:   { type: String, required: true },
    sector:    { type: String },
    chro:      { type: String },  // "Name (Date)"
    workforce: { type: String },  // display string
    why:       { type: String },
    angle:     { type: String },
  },
  { _id: false }
);

const Tier2TargetSchema = new Schema(
  {
    company:        { type: String, required: true },
    sector:         { type: String },
    decision_maker: { type: String },
    why:            { type: String },
    focus:          { type: String },
  },
  { _id: false }
);

const RecommendationSchema = new Schema(
  {
    icon:   { type: String },
    title:  { type: String, required: true },
    points: [{ type: String }],
  },
  { _id: false }
);

const TailwindHeadwindSchema = new Schema(
  {
    title: { type: String, required: true },
    desc:  { type: String },
  },
  { _id: false }
);

// ══════════════════════════════════════════════════════════════════════════
// Company sub-schema  (core research data + human-in-loop fields)
// ══════════════════════════════════════════════════════════════════════════

const ApolloEnrichmentSchema = new Schema(
  {
    email:           { type: String, trim: true },
    phone:           { type: String, trim: true },
    linkedinUrl:     { type: String, trim: true },
    confidenceScore: { type: Number, min: 0, max: 100 },
    enrichedAt:      { type: Date },
  },
  { _id: false }
);

const CompanySchema = new Schema(
  {
    // ── Research data (from JSON, never edited by UI) ──────────────────
    sn:               { type: Number, required: true },
    company:          { type: String, required: true, trim: true },
    subsector:        { type: String, trim: true },
    primary_buyer:    { type: String, trim: true },
    secondary_buyers: { type: String, trim: true },
    buying_signal:    { type: String, trim: true },
    hrd_themes:       { type: String, trim: true },   // comma-separated
    sales_angle:      { type: String, trim: true },
    hot:              { type: Boolean, default: false },

    // ── Human-in-loop decision (set by leadership in dashboard) ───────
    status: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending',
      index:   true,
    },

    rejection_reason: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Required when status = rejected; stored to block-list',
    },

    approved_by:  { type: String, trim: true },   // username / email
    approved_at:  { type: Date },
    rejected_by:  { type: String, trim: true },
    rejected_at:  { type: Date },

    // ── Existing client cross-reference ───────────────────────────────
    isExistingClient: {
      type:    Boolean,
      default: false,
      comment: 'True if company matched a record in ca_clients. Set at import time.',
    },
    clientCuid: {
      type:    String,
      trim:    true,
      comment: 'CUID from ca_clients if isExistingClient = true',
    },

    // ── Apollo.io enrichment (runs after approval) ────────────────────
    apollo_enriched:  { type: Boolean, default: false },
    apollo_data:      { type: ApolloEnrichmentSchema, default: null },
  },
  { _id: true }   // keep _id so we can update individual companies via subdoc id
);

// ══════════════════════════════════════════════════════════════════════════
// Sector sub-schema
// ══════════════════════════════════════════════════════════════════════════

const SectorSchema = new Schema(
  {
    id:               { type: String, required: true },   // "bfsi", "it", etc.
    name:             { type: String, required: true },   // "BFSI"
    full_name:        { type: String },
    subtitle:         { type: String },
    opportunity:      { type: String },                   // display "Rs 500 Cr+"
    employees:        { type: String },                   // display "5.5M+"
    chart_opportunity:{ type: Number },                   // numeric for Chart.js
    chart_employees:  { type: Number },
    chart_ai_gap:     { type: Number },
    chart_color:      { type: String },                   // hex "#E95757"
    metrics:          [MetricCardSchema],
    tailwinds:        [TailwindHeadwindSchema],
    headwinds:        [TailwindHeadwindSchema],
    companies:        [CompanySchema],
  },
  { _id: false }
);

// ══════════════════════════════════════════════════════════════════════════
// Main CAReport schema
// ══════════════════════════════════════════════════════════════════════════

const CAReportSchema = new Schema(
  {
    // ── Report identity ──────────────────────────────────────────────────
    editionKey: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
      index:    true,
      comment:  'Machine-readable key: "2026-05". Used as URL param and dedup key.',
      // derive from edition label on pre-save if not provided
    },

    // ── meta block (mirrors JSON exactly) ────────────────────────────────
    meta: {
      report_name:       { type: String, default: 'Chrysalis HRD Market Intelligence Report' },
      edition:           { type: String, required: true },      // "May 2026"
      prepared_date:     { type: String },                      // "May 27, 2026"
      total_opportunity: { type: String },
      total_companies:   { type: Number },
      total_employees:   { type: String },
      new_chros:         { type: String },
      sectors_count:     { type: Number, default: 6 },
      immediate_window:  { type: String },
      tier1_pipeline:    { type: String },
    },

    // ── overview block ────────────────────────────────────────────────────
    overview: {
      headline:              { type: String },
      metrics:               [MetricCardSchema],
      cross_sector_insights: [InsightSchema],
      chro_timeline:         [ChroTimelineSchema],
      tier1_targets:         [Tier1TargetSchema],
      tier2_targets:         [Tier2TargetSchema],
      recommendations:       [RecommendationSchema],
    },

    // ── sectors + embedded companies ─────────────────────────────────────
    sectors: [SectorSchema],

    // ── Report-level status ───────────────────────────────────────────────
    reportStatus: {
      type:    String,
      enum:    ['draft', 'published', 'archived'],
      default: 'draft',
      index:   true,
    },

    publishedAt: { type: Date },
    publishedBy: { type: String },

    // ── Denormalised rejection summary (for next-month prompt) ───────────
    // Rebuilt automatically on save via pre-save hook.
    rejectedCompanyNames: {
      type:    [String],
      default: [],
      comment: 'All company names with status=rejected in this edition. Used by next-month Claude prompt.',
    },

    // ── Import tracking ───────────────────────────────────────────────────
    importedAt:  { type: Date, default: Date.now },
    importedBy:  { type: String },   // username that uploaded the JSON
    sourceFile:  { type: String },   // original filename e.g. chrysalis_hrd_data_2026_05.json
  },
  {
    timestamps:  true,
    collection:  'ca_reports',
  }
);

// ── Pre-save: rebuild rejectedCompanyNames denorm field ───────────────────
CAReportSchema.pre('save', function (next) {
  const rejected = [];
  (this.sectors || []).forEach((sector) => {
    (sector.companies || []).forEach((co) => {
      if (co.status === 'rejected') rejected.push(co.company);
    });
  });
  this.rejectedCompanyNames = [...new Set(rejected)];
  next();
});

// ── Static: get full rejection block-list across ALL editions ─────────────
CAReportSchema.statics.getRejectionBlockList = async function () {
  const docs = await this.find(
    { 'sectors.companies.status': 'rejected' },
    { 'sectors.companies.company': 1, 'sectors.companies.status': 1, 'sectors.companies.rejection_reason': 1 }
  ).lean();

  const map = new Map();
  docs.forEach((doc) => {
    (doc.sectors || []).forEach((sector) => {
      (sector.companies || []).forEach((co) => {
        if (co.status === 'rejected' && !map.has(co.company)) {
          map.set(co.company, { company: co.company, reason: co.rejection_reason });
        }
      });
    });
  });
  return [...map.values()];
};

// ── Static: get latest published report ───────────────────────────────────
CAReportSchema.statics.getLatest = function () {
  return this.findOne({ reportStatus: 'published' }).sort({ 'meta.edition': -1 }).lean();
};

// ── Index: support dashboard queries ─────────────────────────────────────
CAReportSchema.index({ 'sectors.companies.status': 1 });
CAReportSchema.index({ 'sectors.companies.company': 1 });
CAReportSchema.index({ 'sectors.companies.apollo_enriched': 1 });
CAReportSchema.index({ 'meta.edition': 1 });

module.exports = mongoose.model('CAReport', CAReportSchema);
