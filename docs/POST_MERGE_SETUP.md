# Post-merge setup

Replit runs `scripts/post-merge.sh` with bash after approved task merges, then
reconciles the configured workflows. The `[postMerge]` configuration in `.replit`
provides the script path and a five-minute timeout.

The hook restores exact locked dependencies with `npm ci`, checks TypeScript and
runs the existing production build. That build already invokes `db:migrate`;
the hook does not run migrations twice or add schema changes. Errors fail the
setup immediately instead of hiding a partially prepared workspace.

Run it manually from the project root when needed:

```sh
bash scripts/post-merge.sh
```

No input, new credentials or dependency version changes are required.
Repeated runs restore the same lockfile and reuse the project's migration
tracking. Browser download/setup is kept in the existing test workflow rather
than added to every merge.

The missing-hook configuration was corrected after a merged live-playback
hardening change. Use the platform's post-merge setup runner to verify both the
script and workflow reconciliation; a successful shell build alone does not
prove that the managed preview restarted.
