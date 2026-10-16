# DocuGen

DocuGen is a local-first document generator. Import a Word `.docx` template,
edit its text in the app, insert fields such as `{date}`, `{nom}` or `{email}`,
then generate one document manually or a batch from Excel/CSV.

## Start the app

Requirements: Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Import a DOCX template
from the first card and open its card to edit it. Select an insertion point and
use the field toolbar to insert a value such as `{nom}`.

### Generate one document

Choose **Un document**, enter a value for each detected field and download the
completed DOCX.

### Generate documents from a spreadsheet

Choose **Plusieurs (Excel / CSV)** and upload an `.xlsx` or `.csv` file. Each
field in the template must have a matching column header (case-insensitive).
For Excel, DocuGen scans the workbook's non-empty sheets and rows, so the
header row can be below the top row and the data can be on a sheet after a
cover sheet. All columns are read; unrelated columns are ignored. Each
non-empty data row creates a DOCX in a downloaded ZIP archive. CSV supports
comma, semicolon or tab delimiters.

## Architecture

The current implementation is intentionally a small Next.js application with
clear seams between the UI, HTTP boundary, document operations and local
persistence:

```text
app/
  components/       Client UI components (editor, cards, controls)
  pages/            Dashboard composition and workflow state
  Controllers/      Authentication and Firestore controller operations
  Services/         User profiles and per-user document metadata
  Firebase/         Firebase Auth, Firestore and Storage initialization
  api/              HTTP route handlers: validate requests and shape responses
  lib/              Document/domain operations and local persistence
    docx-template   DOCX validation, placeholder inspection and generation
    docx-editor     Read and update editable DOCX paragraph text
    docx-thumbnail  Extract embedded preview/document images
    spreadsheet     Parse and map Excel/CSV rows to template fields
    template-store  Cloudinary/Firestore and local template repository
```

Route handlers should remain thin: handle HTTP input/output and delegate
document or storage work to `app/lib`. Keep browser-only state and interaction
in client components; do not import server persistence modules into the
browser bundle. User profiles and each user's document metadata are stored in
Firestore under `users/{uid}` and `documents/{documentId}`.

### Local data only

Firebase Authentication handles email/password and Google sign-in. Enable the
providers you plan to use in the Firebase console and deploy
[`firestore.rules`](./firestore.rules) before using the app. Firebase's web app
configuration in `app/Firebase/Config.js` identifies the Firebase project; it
does not contain a server credential.

For Google sign-in on a hosted website, enable the Google provider in Firebase
Authentication and add the website hostname under **Authentication → Settings
→ Authorized domains**. Add `docugen-alpha.vercel.app` (and any preview
hostname you test). An `auth/unauthorized-domain` error means the current
hostname is not on that list; `auth/operation-not-allowed` means Google sign-in
is disabled.

After signup, the app creates a Firestore document at `users/{uid}` with the
user's `id`/`uid`, `email`, and `name`/`nom` fields, along with profile
metadata. Firestore creates the `users` collection automatically when this
first document is saved. If the Firebase Authentication account is created but
its Firestore profile is not, verify that the deployed Firestore rules match
[`firestore.rules`](./firestore.rules) and that Firestore is enabled for the
configured Firebase project.

Uploaded DOCX templates are stored in Cloudinary as raw assets and kept on a
local working copy for local development. On Vercel, signed-in users' template
metadata is stored in the existing Firebase Firestore project using their
Firebase Authentication session, inside each user's existing Firestore profile
document. No service account key or additional Firestore rule is needed.
Signed-out users' template metadata is kept only in their browser. The
Cloudinary cloud name and unsigned upload preset are configured in
`app/lib/cloudinary.ts`; the current defaults are `yal4swpi` and `ml_default`.
Edited templates are uploaded as new Cloudinary versions so the preset can keep overwrite disabled. Each
signed-in user's Firestore document record contains the Cloudinary URL and
`storageProvider: "cloudinary"`. Generated DOCX files and ZIP archives are
also uploaded to Cloudinary and saved in Firestore for signed-in users; for
signed-out users, recent-document and generation-folder metadata is stored in
browser local storage; signed-in users' folder metadata is stored in Firestore
under `users/{uid}/generationFolders/{folderId}`. Generated files and source
spreadsheets remain in Cloudinary. Excel/CSV generations save each generated
DOCX and the source spreadsheet in the folder; the temporary generation ZIP is
not retained as a duplicate history entry. Users can rename and remove
folder/file entries while signed in or
signed out. Removing an entry deletes its Firestore/local-storage metadata; the
underlying Cloudinary asset remains stored. The app reads per-user collections
directly and sorts on the client, without adding Firestore queries or indexes.
Open a folder in **Dossiers de génération** to select files for download or
download the complete folder as a ZIP named after the folder. Folder ZIP
downloads are assembled on the server to avoid browser-side packaging failures;
they support up to 200 files and 250 MB per archive.
Configure Cloudinary to allow unsigned raw uploads for this preset before
importing documents. In local development, working copies and metadata are
kept in `.docugen-data/` by default; set `DOCUGEN_DATA_DIR` to use a different
directory or mounted persistent disk. On Vercel, metadata uses Firestore and
current DOCX files are fetched from Cloudinary.

### Vercel setup and troubleshooting

No Firebase service-account secret or additional Firestore rules are required
on Vercel. Signed-in users save their metadata in their existing Firestore
profile; signed-out users keep it only in their browser. Add
`docugen-alpha.vercel.app` to **Firebase Console → Authentication → Settings
→ Authorized domains** so Google sign-in works on the deployed site.

If an import fails specifically with `mkdir '/var/task/.docugen-data'`, that
was an older deployment attempting to write metadata to Vercel's
read-only filesystem. This was an older deployment attempting to save metadata
on Vercel's ephemeral disk. Deploy the current code. Signed-in template
metadata is stored in Firestore; signed-out metadata is kept in the browser.
Cloudinary upload failures and Firestore metadata failures are reported
separately.

The built-in DOCX gallery is loaded from `app/Docx`; add or remove `.docx`
files in that folder to update the bundled template cards. Clicking a bundled
template adds a copy to the user's document library and Cloudinary, where it
can be downloaded, shared, edited, and managed like an uploaded DOCX.

The Recent Documents list uses local browser storage while signed out and
Firestore under `documents/{documentId}` while signed in. Each successful
signed-in template upload stores its user ID, title, original file name, and
Cloudinary URL in a root document record; sign-in loads only that user's recent
records. Use the card's share/options button to share a saved document by
email. Invitations are stored under the owner's `users/{uid}/invitations`
collection and mirrored to a recipient-specific
`sharedWith/{email}/documents` collection. The app reads that
recipient-specific collection directly and sorts results by update date on the
client, so a collection-group query and a custom Firestore index are not
needed. Use **Actualiser** to check for new invitations. Publish the included
Firestore rules to enable document and invitation access.

While signed out, a browser can import up to two templates and generate up to
five DOCX files. The counters are kept in local browser storage and are not
refunded when a local template is removed. Signing in removes these anonymous
limits. Shared projects are only shown to signed-in users.

### DOCX editing and previews

Template cards render the first page of the actual DOCX file. The in-app editor
is text-focused. It updates paragraph text in the DOCX while
preserving other package parts such as images and tables, but does not render
images on the editing canvas. A neutral placeholder is shown if a document
preview cannot be rendered.

Only upload trusted files.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
