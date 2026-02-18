import { type WorkspaceMemberRole } from "@/lib/auth/permissions";

type InviteEmailAction = "created" | "resent";

type SendInviteEmailInput = {
  toEmail: string;
  workspaceName: string;
  workspaceSlug: string;
  inviteUrl: string;
  invitedByName: string;
  role: WorkspaceMemberRole;
  expiresAtIso: string;
  targetUserExists: boolean;
  action: InviteEmailAction;
};

type InviteEmailDeliveryStatus = "sent" | "skipped" | "failed";

export type InviteEmailDeliveryResult = {
  status: InviteEmailDeliveryStatus;
  provider: "resend" | "none";
  messageId: string;
  error: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDateTimeLabel(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "Not set";

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "Not set";

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRoleLabel(role: WorkspaceMemberRole) {
  return role[0]?.toUpperCase() + role.slice(1);
}

function buildEmailContent(input: SendInviteEmailInput) {
  const subject =
    input.action === "resent"
      ? `Reminder: join ${input.workspaceName} on Synn`
      : `You're invited to join ${input.workspaceName} on Synn`;
  const expiryLabel = formatDateTimeLabel(input.expiresAtIso);
  const roleLabel = formatRoleLabel(input.role);
  const accountStep = input.targetUserExists
    ? "Sign in with your invited email, then accept the invite."
    : "You don't have an account yet. Create one with this same email, then accept the invite.";

  const text = [
    `${input.invitedByName} invited you to join ${input.workspaceName} on Synn as ${roleLabel}.`,
    "",
    `Workspace: ${input.workspaceName} (${input.workspaceSlug})`,
    `Invite link: ${input.inviteUrl}`,
    `Expires: ${expiryLabel}`,
    "",
    accountStep,
  ].join("\n");

  const html = `
    <div style="font-family: Inter, Segoe UI, Arial, sans-serif; max-width: 560px; color: #0f172a;">
      <h2 style="margin: 0 0 12px;">Join ${input.workspaceName} on Synn</h2>
      <p style="margin: 0 0 12px;">
        <strong>${input.invitedByName}</strong> invited you as <strong>${roleLabel}</strong>.
      </p>
      <p style="margin: 0 0 6px;"><strong>Workspace:</strong> ${input.workspaceName} (${input.workspaceSlug})</p>
      <p style="margin: 0 0 16px;"><strong>Expires:</strong> ${expiryLabel}</p>
      <p style="margin: 0 0 16px;">${accountStep}</p>
      <p style="margin: 0 0 20px;">
        <a href="${input.inviteUrl}" style="display: inline-block; background: #0f172a; color: white; text-decoration: none; padding: 10px 16px; border-radius: 4px; font-weight: 600;">
          Open Invite
        </a>
      </p>
      <p style="margin: 0; color: #475569; font-size: 12px;">
        If the button does not work, copy this URL:<br />
        <a href="${input.inviteUrl}">${input.inviteUrl}</a>
      </p>
    </div>
  `.trim();

  return { subject, text, html };
}

function resolveEmailConfig() {
  return {
    resendApiKey: normalizeText(process.env.RESEND_API_KEY),
    fromEmail: normalizeText(process.env.INVITES_EMAIL_FROM),
    replyTo: normalizeText(process.env.INVITES_EMAIL_REPLY_TO),
  };
}

export async function sendWorkspaceInviteEmail(
  input: SendInviteEmailInput,
): Promise<InviteEmailDeliveryResult> {
  const config = resolveEmailConfig();
  if (!config.resendApiKey || !config.fromEmail) {
    return {
      status: "skipped",
      provider: "none",
      messageId: "",
      error: "Invite email provider is not configured.",
    };
  }

  const { subject, text, html } = buildEmailContent(input);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.fromEmail,
        to: [input.toEmail],
        subject,
        html,
        text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          id?: string;
          message?: string;
          error?: { message?: string };
        }
      | null;

    if (!response.ok) {
      const errorMessage =
        normalizeText(payload?.error?.message) ||
        normalizeText(payload?.message) ||
        `Invite email send failed (${response.status}).`;
      return {
        status: "failed",
        provider: "resend",
        messageId: "",
        error: errorMessage,
      };
    }

    return {
      status: "sent",
      provider: "resend",
      messageId: normalizeText(payload?.id),
      error: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite email send failed.";
    return {
      status: "failed",
      provider: "resend",
      messageId: "",
      error: message,
    };
  }
}
