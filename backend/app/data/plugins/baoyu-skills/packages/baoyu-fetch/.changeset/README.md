# Changesets

This folder stores release notes for version bumps managed by Changesets.

Create a new changeset before merging a user-facing change:

```bash
bunx changeset
```

After the changeset lands on `main`, GitHub Actions will open or update the release PR automatically. Merging that release PR publishes the next npm version.
