# APEX Genesis V9.1 source importer

Upload **only** `APEX_GENESIS_V9_1_SAFE_PUBLIC_IMPORT.zip` into this `imports/` folder using GitHub's **Add file → Upload files** interface. The workflow `Import APEX V9.1 safe source` will validate the ZIP's exact SHA-256, unpack the source and tests, and commit them to `main`.

Source archive expected SHA-256:

`28c680c77b9c7f49ef50af12b6ab26d85ee0d048e89ec836f8d258bd0e80a1cb`

**Do not upload the 75 MB original Gemini ZIP.** It contains local Git history, generated builds and old screenshots; use the separately prepared 251 KB source-only import ZIP.

After upload, check the [GitHub Actions page](https://github.com/akshatgogri458-blip/apex-genesis-os/actions) for a successful run and verify the remote source in `src/worker.ts`. GitHub Actions must have repository write permission. An importer failure is not proof of successful publication.

Gemini web GitHub import is read-only. Gemini can inspect public code from a different Google account, but commit publication needs an authorized GitHub writer.