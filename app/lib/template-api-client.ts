"use client";

import { getLocalTemplate } from "@/app/lib/local-template-store";
import { auth } from "@/app/Firebase/Config";

export async function templateApiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  templateId?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;
  if (user) {
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  }
  if (templateId) {
    const template = getLocalTemplate(templateId);
    if (template) {
      headers.set("X-Docugen-Template", JSON.stringify(template));
    }
  }
  return fetch(input, { ...init, headers });
}
