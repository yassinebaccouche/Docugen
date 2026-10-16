import "server-only";

import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const ADMIN_APP_NAME = "docugen-template-metadata";

interface FirebaseServiceAccountJson {
  project_id?: unknown;
  client_email?: unknown;
  private_key?: unknown;
}

export function getTemplateMetadataFirestore() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!serviceAccountJson) {
    throw new Error(
      "Template storage is not configured. Add FIREBASE_SERVICE_ACCOUNT_JSON to the Vercel deployment environment.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON must contain the Firebase service-account JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON must contain a Firebase service-account object.",
    );
  }
  const accountJson: FirebaseServiceAccountJson = {
    project_id: "project_id" in parsed ? parsed.project_id : undefined,
    client_email: "client_email" in parsed ? parsed.client_email : undefined,
    private_key: "private_key" in parsed ? parsed.private_key : undefined,
  };

  if (
    typeof accountJson.project_id !== "string" ||
    typeof accountJson.client_email !== "string" ||
    typeof accountJson.private_key !== "string"
  ) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key.",
    );
  }

  const serviceAccount: ServiceAccount = {
    projectId: accountJson.project_id,
    clientEmail: accountJson.client_email,
    privateKey: accountJson.private_key.replace(/\\n/g, "\n"),
  };
  const existingApp = getApps().find((app) => app.name === ADMIN_APP_NAME);
  const app =
    existingApp ??
    initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
      },
      ADMIN_APP_NAME,
    );

  return getFirestore(app);
}
