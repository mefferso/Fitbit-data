# clasp setup for Fitbit-data

This repository mirrors the Google Apps Script project used by the Fitbit Health Dashboard.

## One-time setup

1. Install Node.js 22+.
2. Install clasp:
   `npm install -g @google/clasp`
3. Enable the Apps Script API for the Google account that owns the script.
4. Log in:
   `clasp login`
5. From the repository root, create `.clasp.json`:

```json
{
  "scriptId": "1Ww05gra0omu1yRAbWHgwaZthXNPMLT-x_sLRffH1RIjzXpm4Z_eSwfOH",
  "rootDir": "."
}
```

6. Verify what clasp will upload:
   `clasp show-file-status`

## Normal workflow

Pull from GitHub first:

```bash
git pull
```

Push the repository's Apps Script files to Google Apps Script:

```bash
clasp push
```

Open the Apps Script project:

```bash
clasp open-script
```

If you intentionally make changes in the Apps Script editor and need to bring them back locally:

```bash
clasp pull
git status
```

Review the diff before committing because `clasp pull` can overwrite local Apps Script files.

## Important

- `.claspignore` restricts uploads to root-level `.gs`, `.html`, and `appsscript.json`.
- `.clasp.json` and clasp credentials are ignored by Git and should not be committed.
- `clasp push` replaces the Apps Script project's source set, so always run `clasp show-file-status` before the first push.
