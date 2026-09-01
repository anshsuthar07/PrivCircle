import {
  bigint,
  boolean,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

export const lifetimeRooms = pgTable("lifetime_rooms", {
  id: uuid("id").primaryKey(),
  path: varchar("path", { length: 64 }).notNull().unique(),
  passwordRequired: boolean("password_required").notNull().default(false),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const lifetimeDocuments = pgTable("lifetime_documents", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => lifetimeRooms.id, { onDelete: "cascade" }),
  state: bytea("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LifetimeRoomRow = typeof lifetimeRooms.$inferSelect;

/**
 * Temporary room documents.
 *
 * `roomId` deliberately has no foreign key to `lifetimeRooms`: expiring rooms
 * (1h/24h/7d) live only in Redis and never get a PostgreSQL row, so a constraint
 * here would make them unable to share files. Authorization always resolves the
 * room through `getRoom(path)` first, so the id is never trusted from a client.
 */
export const roomDocuments = pgTable(
  "room_documents",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id").notNull(),
    roomPath: varchar("room_path", { length: 64 }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("room_documents_room_expires_idx").on(table.roomId, table.expiresAt),
    index("room_documents_expires_at_idx").on(table.expiresAt),
  ],
);

export type RoomDocumentRow = typeof roomDocuments.$inferSelect;
