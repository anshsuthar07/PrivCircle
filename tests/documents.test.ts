import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { roomDocuments } from "@/db/schema";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/config";
import {
  documentStorageKey,
  isDocumentId,
  isKeyInRoom,
  safeContentType,
  safeDisplayName,
  sanitizeFilename,
} from "@/lib/documents/filenames";
import {
  createPendingDocument,
  findDownloadableDocument,
  findRoomDocument,
  getRoomUsage,
  listRoomDocuments,
  markDocumentReady,
} from "@/lib/documents/store";
import { getRedis } from "@/lib/redis";
import { createDocumentSchema } from "@/lib/validation";

const createdRoomIds: string[] = [];

function newRoomId() {
  const roomId = crypto.randomUUID();
  createdRoomIds.push(roomId);
  return roomId;
}

async function seedDocument(input: {
  roomId: string;
  filename?: string;
  ready?: boolean;
  size?: number;
  expiresInSeconds?: number;
}) {
  const documentId = crypto.randomUUID();
  const filename = input.filename ?? "report.pdf";
  const row = await createPendingDocument({
    documentId,
    roomId: input.roomId,
    roomPath: `room-${input.roomId.slice(0, 8)}`,
    storageKey: documentStorageKey({ roomId: input.roomId, documentId, filename }),
    filename,
    contentType: "application/pdf",
    declaredSize: input.size ?? 1024,
    uploadedBy: crypto.randomUUID(),
  });
  if (!row) throw new Error("Document was not created.");

  if (input.ready !== false) {
    await markDocumentReady({
      documentId,
      roomId: input.roomId,
      sizeBytes: input.size ?? 1024,
      contentType: "application/pdf",
    });
  }

  if (input.expiresInSeconds !== undefined) {
    await getDatabase()
      .update(roomDocuments)
      .set({
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      })
      .where(eq(roomDocuments.id, documentId));
  }

  return { documentId, filename, row };
}

afterAll(async () => {
  const database = getDatabase();
  for (const roomId of createdRoomIds) {
    await database.delete(roomDocuments).where(eq(roomDocuments.roomId, roomId));
  }
  getRedis().disconnect();
});

describe("storage key safety", () => {
  it.each([
    ["../../secret.txt", "secret.txt"],
    ["..\\..\\windows\\system32\\config", "config"],
    ["/etc/passwd", "passwd"],
    ["....//evil", "evil"],
    ["..", "file"],
    ["", "file"],
    ["   ", "file"],
  ])("reduces %j to a single inert segment", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("keeps a traversal attempt inside the room namespace", () => {
    const roomId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const key = documentStorageKey({
      roomId,
      documentId,
      filename: "../../../other-room/secret.pdf",
    });

    expect(key).toBe(`rooms/${roomId}/${documentId}/secret.pdf`);
    expect(key).not.toContain("..");
    expect(isKeyInRoom(key, roomId)).toBe(true);
    expect(isKeyInRoom(key, crypto.randomUUID())).toBe(false);
  });

  it("strips control characters from the stored display name", () => {
    expect(safeDisplayName("re\u0000port\u001f.pdf")).toBe("report.pdf");
    expect(safeDisplayName("a/b/c/notes.txt")).toBe("notes.txt");
  });

  it("never records an active document type", () => {
    expect(safeContentType("text/html")).toBe("application/octet-stream");
    expect(safeContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeContentType("not a type")).toBe("application/octet-stream");
    expect(safeContentType(undefined)).toBe("application/octet-stream");
    expect(safeContentType("application/pdf; charset=utf-8")).toBe("application/pdf");
  });

  it("rejects identifiers that are not uuids", () => {
    expect(isDocumentId(crypto.randomUUID())).toBe(true);
    expect(isDocumentId("../../etc/passwd")).toBe(false);
    expect(isDocumentId("1 OR 1=1")).toBe(false);
    expect(isDocumentId("")).toBe(false);
  });
});

describe("upload size limits", () => {
  it("accepts a file at exactly the 300 MB ceiling", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(300 * 1024 * 1024);
    const parsed = createDocumentSchema.safeParse({
      filename: "big.zip",
      size: MAX_DOCUMENT_BYTES,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects 300 MB plus one byte as too large", () => {
    const parsed = createDocumentSchema.safeParse({
      filename: "big.zip",
      size: MAX_DOCUMENT_BYTES + 1,
    });
    expect(parsed.success).toBe(false);
    expect(
      parsed.success
        ? []
        : parsed.error.issues.filter(
            (issue) => issue.path[0] === "size" && issue.code === "too_big",
          ),
    ).toHaveLength(1);
  });
});

describe("document metadata", () => {
  it("expires exactly 24 hours after creation, using the database clock", async () => {
    const roomId = newRoomId();
    const { row } = await seedDocument({ roomId, ready: false });

    const lifetime = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(lifetime).toBe(24 * 60 * 60 * 1000);
  });

  it("lists only finalized, unexpired documents", async () => {
    const roomId = newRoomId();
    const ready = await seedDocument({ roomId, filename: "shared.pdf" });
    await seedDocument({ roomId, filename: "half-uploaded.pdf", ready: false });
    await seedDocument({
      roomId,
      filename: "gone.pdf",
      expiresInSeconds: -60,
    });

    const documents = await listRoomDocuments(roomId);
    expect(documents.map((document) => document.id)).toEqual([ready.documentId]);
    expect(documents[0].filename).toBe("shared.pdf");
  });

  it("keeps documents invisible to another room", async () => {
    const roomA = newRoomId();
    const roomB = newRoomId();
    const secret = await seedDocument({ roomId: roomA, filename: "secret.pdf" });

    await expect(
      findRoomDocument({ documentId: secret.documentId, roomId: roomB }),
    ).resolves.toBeNull();
    await expect(
      findDownloadableDocument({ documentId: secret.documentId, roomId: roomB }),
    ).resolves.toBeNull();
    await expect(listRoomDocuments(roomB)).resolves.toEqual([]);

    // The same id is still reachable from its own room, so the isolation above
    // is room scoping rather than the document simply being unreadable.
    await expect(
      findDownloadableDocument({ documentId: secret.documentId, roomId: roomA }),
    ).resolves.not.toBeNull();
  });

  it("refuses to serve a document the moment it expires", async () => {
    const roomId = newRoomId();
    const expired = await seedDocument({ roomId, expiresInSeconds: -1 });

    await expect(
      findDownloadableDocument({ documentId: expired.documentId, roomId }),
    ).resolves.toBeNull();
    await expect(listRoomDocuments(roomId)).resolves.toEqual([]);
  });

  it("counts pending uploads against the room quota", async () => {
    const roomId = newRoomId();
    await seedDocument({ roomId, size: 2048 });
    await seedDocument({ roomId, ready: false, size: 4096 });
    await seedDocument({ roomId, size: 8192, expiresInSeconds: -60 });

    const usage = await getRoomUsage(roomId);
    expect(usage.documents).toBe(2);
    expect(usage.bytes).toBe(2048 + 4096);
  });

  it("records the true size at finalization, not the declared one", async () => {
    const roomId = newRoomId();
    const { documentId } = await seedDocument({
      roomId,
      ready: false,
      size: 1,
    });

    const ready = await markDocumentReady({
      documentId,
      roomId,
      sizeBytes: 5_242_880,
      contentType: "application/pdf",
    });

    expect(ready?.sizeBytes).toBe(5_242_880);
    expect(ready?.status).toBe("ready");
  });

  it("will not finalize a document through the wrong room", async () => {
    const roomId = newRoomId();
    const other = newRoomId();
    const { documentId } = await seedDocument({ roomId, ready: false });

    await expect(
      markDocumentReady({
        documentId,
        roomId: other,
        sizeBytes: 10,
        contentType: "application/pdf",
      }),
    ).resolves.toBeNull();
  });
});
