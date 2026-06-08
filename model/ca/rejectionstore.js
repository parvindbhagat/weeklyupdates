/**
 * models/ca/rejectionstore.js
 * ─────────────────────────────────────────────────────────────────────────
 * Persistent, cross-edition rejection block-list.
 *
 * Why a separate collection?
 *  - CAReport embeds rejectedCompanyNames per edition (fast denorm).
 *  - This collection is the single source of truth that the monthly
 *    Claude prompt reads to know what to exclude, regardless of which
 *    edition first rejected the company.
 *  - Survives report archival — rejections are permanent until manually
 *    pardoned.
 *
 * Collection:  ca_rejection_store
 * ─────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const RejectionStoreSchema = new Schema(
  {
    // ── Identity ───────────────────────────────────────────────────────
    company: {
      type:     String,
      required: [true, 'Company name is required'],
      trim:     true,
      index:    true,
    },

    normalisedName: {
      type:  String,
      index: true,
      comment: 'Lowercase stripped name for fuzzy matching (auto-computed)',
    },

    // ── Rejection details ──────────────────────────────────────────────
    rejection_reason: {
      type:     String,
      trim:     true,
      required: [true, 'A rejection reason must be provided'],
      comment:  'Free text from leadership explaining why excluded',
    },

    rejected_by: {
      type:    String,
      trim:    true,
      comment: 'Username / email of the leadership user who rejected',
    },

    rejected_in_edition: {
      type:    String,
      trim:    true,
      comment: 'Edition key when first rejected e.g. "2026-05"',
    },

    // ── Expiry / pardon ────────────────────────────────────────────────
    neverShowAgain: {
      type:    Boolean,
      default: false,
      comment: 'True = permanent exclusion. False = time-limited, check expires_at.',
    },

    expires_at: {
      type:    Date,
      default: null,
      comment: 'If set and neverShowAgain=false, company re-enters pool after this date.',
      index:   true,
    },

    pardonedAt: {
      type:    Date,
      default: null,
      comment: 'Set when an admin manually re-enables a company',
    },

    pardonedBy: {
      type:    String,
      trim:    true,
    },

    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
      comment: 'False = pardoned / expired. Used in block-list queries.',
    },
  },
  {
    timestamps:  true,
    collection:  'ca_rejection_store',
  }
);

// ── Enforce uniqueness on normalised name (one active block per company) ──
RejectionStoreSchema.index(
  { normalisedName: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// ── Pre-save: compute normalisedName ──────────────────────────────────────
RejectionStoreSchema.pre('save', function (next) {
  if (this.isModified('company') || this.isNew) {
    this.normalisedName = normalise(this.company);
  }
  next();
});

// ── Static: get active block-list (for Claude prompt and import filter) ───
RejectionStoreSchema.statics.getActiveBlockList = async function () {
  const now = new Date();
  return this.find({
    isActive: true,
    $or: [
      { neverShowAgain: true },
      { expires_at: null },
      { expires_at: { $gt: now } },
    ],
  })
    .select('company normalisedName rejection_reason rejected_in_edition neverShowAgain expires_at')
    .lean();
};

// ── Static: check if a single company is blocked ─────────────────────────
RejectionStoreSchema.statics.isBlocked = async function (companyName) {
  const norm = normalise(companyName);
  const now  = new Date();
  return this.findOne({
    normalisedName: norm,
    isActive: true,
    $or: [
      { neverShowAgain: true },
      { expires_at: null },
      { expires_at: { $gt: now } },
    ],
  }).lean();
};

// ── Static: add or refresh a rejection ────────────────────────────────────
RejectionStoreSchema.statics.upsertRejection = async function ({
  company,
  rejection_reason,
  rejected_by,
  rejected_in_edition,
  neverShowAgain = false,
  expires_at     = null,
}) {
  const norm = normalise(company);
  return this.findOneAndUpdate(
    { normalisedName: norm },
    {
      $set: {
        company,
        normalisedName: norm,
        rejection_reason,
        rejected_by,
        rejected_in_edition,
        neverShowAgain,
        expires_at,
        isActive:   true,
        pardonedAt: null,
        pardonedBy: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

// ── Static: pardon (re-enable) a company ─────────────────────────────────
RejectionStoreSchema.statics.pardon = async function (companyName, pardonedBy) {
  const norm = normalise(companyName);
  return this.findOneAndUpdate(
    { normalisedName: norm },
    {
      $set: {
        isActive:   false,
        pardonedAt: new Date(),
        pardonedBy,
      },
    },
    { new: true }
  );
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

module.exports = mongoose.model('RejectionStore', RejectionStoreSchema);
