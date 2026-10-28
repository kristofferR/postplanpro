import { pool } from "./db.js";
import { config } from "./config.js";
import { getDraftPublicUrl, getDraftRawUrl } from "./public-url.js";

// The "my docs" feed: every draft owned by an account, favorites first, then
// newest first, with the aggregates a dashboard needs (latest version, version
// count, repo). Shared by GET /api/drafts and the server-rendered dashboard.
export async function listAccountDrafts(accountId, { requestBaseUrl }) {
  const result = await pool.query(
    `
      SELECT
        d.id,
        d.slug,
        d.title,
        d.description,
        d.repo_org,
        d.repo_name,
        d.repo_host,
        d.created_at,
        d.updated_at,
        d.disabled_at,
        d.favorited_at,
        cv.version_number AS latest_version_number,
        cv.created_at AS latest_version_at,
        COALESCE(vc.version_count, 0) AS version_count
      FROM drafts d
      LEFT JOIN draft_versions cv ON cv.id = d.current_version_id
      LEFT JOIN (
        SELECT draft_id, COUNT(*)::int AS version_count
        FROM draft_versions
        GROUP BY draft_id
      ) vc ON vc.draft_id = d.id
      WHERE d.account_id = $1
        AND d.deleted_at IS NULL
      ORDER BY d.favorited_at IS NULL, d.updated_at DESC
    `,
    [accountId]
  );

  return result.rows.map((row) => ({
    draftId: row.id,
    slug: row.slug ?? null,
    title: row.title,
    description: row.description,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
    repoHost: row.repo_host,
    latestVersionNumber:
      row.latest_version_number === null ? null : Number(row.latest_version_number),
    versionCount: Number(row.version_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersionAt: row.latest_version_at,
    disabled: Boolean(row.disabled_at),
    favorite: Boolean(row.favorited_at),
    publicUrl: getDraftPublicUrl({
      draftId: row.slug || row.id,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl
    }),
    rawUrl: getDraftRawUrl({
      draftId: row.slug || row.id,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl
    })
  }));
}

// Adds or removes one of the account's drafts from its favorites. `ref` is a
// draft ID or custom URL slug. Returns the draft ID, or null when the account
// has no such draft. Does not touch updated_at: favoriting is not an edit.
export async function setDraftFavorite(accountId, ref, favorite) {
  const result = await pool.query(
    `
      UPDATE drafts
      SET favorited_at = $3
      WHERE (id = $1 OR slug = $1)
        AND account_id = $2
        AND deleted_at IS NULL
      RETURNING id
    `,
    [ref, accountId, favorite ? new Date() : null]
  );
  return result.rows[0]?.id ?? null;
}

export async function getAccountDraftWithVersions(accountId, draftId, { requestBaseUrl }) {
  const draftResult = await pool.query(
    `
      SELECT *
      FROM drafts
      WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
      LIMIT 1
    `,
    [draftId, accountId]
  );
  const draft = draftResult.rows[0];
  if (!draft) return null;

  const versionsResult = await pool.query(
    `
      SELECT id, version_number, created_at, git_branch, git_commit_sha,
             git_commit_subject, git_dirty, file_size
      FROM draft_versions
      WHERE draft_id = $1
      ORDER BY version_number DESC
    `,
    [draftId]
  );

  return {
    draft: {
      draftId: draft.id,
      title: draft.title,
      description: draft.description,
      publicUrl: getDraftPublicUrl({
        draftId: draft.slug || draft.id,
        publicBaseUrl: config.publicBaseUrl,
        requestBaseUrl
      }),
      // Version links use the draft ID, which never moves to another draft.
      versionBaseUrl: getDraftPublicUrl({
        draftId: draft.id,
        publicBaseUrl: config.publicBaseUrl,
        requestBaseUrl
      })
    },
    versions: versionsResult.rows
  };
}
