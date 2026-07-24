# Plan 127: Preserve CMS content when games or media channels are deleted

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23
- **Implementation**: DONE

## Why this matters

A media-channel post may carry `game_slug` only as an optional tag. Deleting
the game must not delete that media-owned article. Conversely, deleting a
media channel while it owns posts would leave content that cannot be rendered
or managed.

The implemented ownership policy is:

- game-owned posts have `media_slug IS NULL` and are deleted with their game;
- media-owned posts retain ownership and only lose an optional game tag;
- media channels related to a deleted game remain and lose that game tag;
- a media channel cannot be deleted until its owned posts are moved or removed.

## Implemented changes

### Transactional game deletion

`deleteEwcGame` now performs every mutation through one transaction:

1. delete translations for game-owned posts;
2. delete only game-owned posts;
3. clear the optional game tag from media-owned posts;
4. clear the optional game tag from related media channels;
5. remove admin game scopes;
6. remove the game.

It returns `gameDeleted`, `postsDeleted`, `mediaPostsDetached`, and
`mediaChannelsDetached`.

### Transactional media deletion

`deleteEwcMediaChannel` counts owned posts inside its transaction before
changing any data. A non-zero count returns a `media_has_posts` conflict and
leaves the channel, admin scopes, Discord linkage, and posts unchanged. Empty
channels still delete with their auxiliary rows.

### API behavior

- Game deletion returns and audits every deleted/detached count.
- Media deletion returns HTTP 409 with `media_has_posts` and `postCount`.
- Rejected and not-found deletions do not write audit rows or invalidate caches.
- Successful changes invalidate the affected game, media, and news views.

## Verification

- `tests/ewcGamesCascade.test.mjs` covers ownership-aware deletion, optional
  tag detachment, dependent-row behavior, unrelated rows, and admin scopes.
- `tests/ewcMediaDeletion.test.mjs` covers blocked and successful media deletes.
- `apps/web/src/test/admin-content-deletion.test.ts` covers route responses,
  audits, authorization, and cache invalidation.
- `tests/postgresDbParity.test.mjs` exercises the same ownership policy on
  PostgreSQL.

## Done criteria

- [x] Game deletion never deletes a post with non-null `media_slug`.
- [x] Related media posts and channels only have their optional game tag cleared.
- [x] Media-channel deletion is blocked while any owned post exists.
- [x] Operations use the shared transaction abstraction on both backends.
- [x] API and audit records distinguish deleted from detached rows.
- [x] Focused and repository verification gates pass.

