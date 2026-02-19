import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before, beforeEach } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");
const projectId = "synnapp-firestore-rules";
const workspaceId = "ws-1";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseData();
});

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "workspaces", workspaceId), {
      name: "Acme",
      slug: "acme",
      createdBy: "owner-1",
      createdAt: 1,
      updatedAt: 1,
    });

    const members = [
      { uid: "owner-1", role: "owner" },
      { uid: "admin-1", role: "admin" },
      { uid: "member-1", role: "member" },
      { uid: "viewer-1", role: "viewer" },
    ];

    for (const member of members) {
      await setDoc(doc(db, "workspaces", workspaceId, "members", member.uid), {
        ...member,
        displayName: member.uid,
        email: `${member.uid}@example.com`,
        joinedAt: 1,
        updatedAt: 1,
      });
    }

    await setDoc(doc(db, "workspaces", workspaceId, "decisions", "D-1"), {
      title: "Initial decision",
      statement: "Initial statement",
      ownerUid: "member-1",
      archived: false,
      archivedAt: null,
      archivedBy: "",
      updatedAt: 1,
      updatedBy: "member-1",
      createdAt: 1,
      createdBy: "member-1",
    });

    await setDoc(doc(db, "workspaces", workspaceId, "actions", "A-1"), {
      title: "Initial action",
      description: "Initial action",
      ownerUid: "member-1",
      status: "open",
      archived: false,
      archivedAt: null,
      archivedBy: "",
      updatedAt: 1,
      updatedBy: "member-1",
      createdAt: 1,
      createdBy: "member-1",
    });

    await setDoc(doc(db, "workspaces", workspaceId, "invites", "I-1"), {
      inviteId: "I-1",
      token: "token-1",
      email: "invitee@example.com",
      role: "member",
      status: "pending",
      invitedByUid: "admin-1",
      invitedByName: "admin-1",
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 9999999999999,
      resendCount: 0,
    });

    await setDoc(doc(db, "users", "owner-1"), {
      uid: "owner-1",
      displayName: "Owner One",
    });
    await setDoc(doc(db, "users", "member-1"), {
      uid: "member-1",
      displayName: "Member One",
    });
  });
}

test("workspace members can read workspace docs", async () => {
  const memberDb = authedDb("member-1");
  const workspaceRef = doc(memberDb, "workspaces", workspaceId);
  await assertSucceeds(getDoc(workspaceRef));
});

test("non-members cannot read workspace docs", async () => {
  const outsiderDb = authedDb("outsider-1");
  const workspaceRef = doc(outsiderDb, "workspaces", workspaceId);
  await assertFails(getDoc(workspaceRef));
});

test("users can read and update only their own user doc", async () => {
  const memberDb = authedDb("member-1");
  const ownUserRef = doc(memberDb, "users", "member-1");
  const ownerUserRef = doc(memberDb, "users", "owner-1");

  await assertSucceeds(getDoc(ownUserRef));
  await assertFails(getDoc(ownerUserRef));
  await assertSucceeds(
    updateDoc(ownUserRef, {
      displayName: "Member One Updated",
      uid: "member-1",
    }),
  );
  await assertFails(
    updateDoc(ownerUserRef, {
      displayName: "Hijacked",
      uid: "owner-1",
    }),
  );
});

test("viewer cannot create decisions", async () => {
  const viewerDb = authedDb("viewer-1");
  const decisionRef = doc(viewerDb, "workspaces", workspaceId, "decisions", "D-viewer");

  await assertFails(
    setDoc(decisionRef, {
      title: "Viewer decision",
      statement: "Should fail",
      archived: false,
      createdAt: 1,
      createdBy: "viewer-1",
      updatedAt: 1,
      updatedBy: "viewer-1",
    }),
  );
});

test("member can create and update non-archive decision fields", async () => {
  const memberDb = authedDb("member-1");
  const decisionRef = doc(memberDb, "workspaces", workspaceId, "decisions", "D-member");

  await assertSucceeds(
    setDoc(decisionRef, {
      title: "Member decision",
      statement: "Allowed",
      archived: false,
      createdAt: 1,
      createdBy: "member-1",
      updatedAt: 1,
      updatedBy: "member-1",
    }),
  );

  await assertSucceeds(
    updateDoc(decisionRef, {
      statement: "Updated by member",
      updatedAt: 2,
      updatedBy: "member-1",
    }),
  );
});

test("member cannot archive a decision", async () => {
  const memberDb = authedDb("member-1");
  const decisionRef = doc(memberDb, "workspaces", workspaceId, "decisions", "D-1");

  await assertFails(
    updateDoc(decisionRef, {
      archived: true,
      archivedAt: 2,
      archivedBy: "member-1",
      updatedAt: 2,
      updatedBy: "member-1",
    }),
  );
});

test("admin can archive a decision", async () => {
  const adminDb = authedDb("admin-1");
  const decisionRef = doc(adminDb, "workspaces", workspaceId, "decisions", "D-1");

  await assertSucceeds(
    updateDoc(decisionRef, {
      archived: true,
      archivedAt: 2,
      archivedBy: "admin-1",
      updatedAt: 2,
      updatedBy: "admin-1",
    }),
  );

  const updated = await getDoc(decisionRef);
  assert.equal(updated.data()?.archived, true);
});

test("viewer cannot edit actions", async () => {
  const viewerDb = authedDb("viewer-1");
  const actionRef = doc(viewerDb, "workspaces", workspaceId, "actions", "A-1");

  await assertFails(
    updateDoc(actionRef, {
      status: "done",
      updatedAt: 2,
      updatedBy: "viewer-1",
    }),
  );
});

test("member cannot manage member roles, admin can", async () => {
  const memberDb = authedDb("member-1");
  const adminDb = authedDb("admin-1");
  const targetMemberRefAsMember = doc(
    memberDb,
    "workspaces",
    workspaceId,
    "members",
    "viewer-1",
  );
  const targetMemberRefAsAdmin = doc(
    adminDb,
    "workspaces",
    workspaceId,
    "members",
    "viewer-1",
  );

  await assertFails(
    updateDoc(targetMemberRefAsMember, {
      role: "member",
      updatedAt: 2,
    }),
  );

  await assertSucceeds(
    updateDoc(targetMemberRefAsAdmin, {
      role: "member",
      updatedAt: 2,
    }),
  );
});

test("member cannot read or create workspace invites", async () => {
  const memberDb = authedDb("member-1");
  const existingInviteRef = doc(memberDb, "workspaces", workspaceId, "invites", "I-1");
  const newInviteRef = doc(memberDb, "workspaces", workspaceId, "invites", "I-2");

  await assertFails(getDoc(existingInviteRef));
  await assertFails(
    setDoc(newInviteRef, {
      inviteId: "I-2",
      token: "token-2",
      email: "new@example.com",
      role: "member",
      status: "pending",
      invitedByUid: "member-1",
      invitedByName: "member-1",
      createdAt: 2,
      updatedAt: 2,
      expiresAt: 9999999999999,
      resendCount: 0,
    }),
  );
});

test("admin can read and create workspace invites", async () => {
  const adminDb = authedDb("admin-1");
  const existingInviteRef = doc(adminDb, "workspaces", workspaceId, "invites", "I-1");
  const newInviteRef = doc(adminDb, "workspaces", workspaceId, "invites", "I-3");

  await assertSucceeds(getDoc(existingInviteRef));
  await assertSucceeds(
    setDoc(newInviteRef, {
      inviteId: "I-3",
      token: "token-3",
      email: "admin-invite@example.com",
      role: "member",
      status: "pending",
      invitedByUid: "admin-1",
      invitedByName: "admin-1",
      createdAt: 2,
      updatedAt: 2,
      expiresAt: 9999999999999,
      resendCount: 0,
    }),
  );
});

test("clients cannot read workspace invite token documents", async () => {
  const memberDb = authedDb("member-1");
  const tokenRef = doc(memberDb, "workspaceInviteTokens", "token-1");

  await assertFails(getDoc(tokenRef));
});

test("clients cannot read or write guardrail collections", async () => {
  const ownerDb = authedDb("owner-1");
  const rateLimitRef = doc(ownerDb, "apiRateLimits", "sample");
  const auditLogRef = doc(ownerDb, "apiAuditLogs", "sample");

  await assertFails(getDoc(rateLimitRef));
  await assertFails(getDoc(auditLogRef));
  await assertFails(
    setDoc(rateLimitRef, {
      routeId: "sample",
      count: 1,
      windowSeconds: 60,
    }),
  );
  await assertFails(
    setDoc(auditLogRef, {
      routeId: "sample",
      outcome: "success",
      statusCode: 200,
    }),
  );
});
