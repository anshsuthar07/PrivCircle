import {
  boolean,
  customType,
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
