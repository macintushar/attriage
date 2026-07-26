PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sessionId` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`transcript` text,
	`audioPath` text,
	`createdAt` integer NOT NULL,
	`audioSeconds` real,
	CONSTRAINT `fk_messages_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_messages`(`id`, `sessionId`, `role`, `kind`, `text`, `transcript`, `audioPath`, `createdAt`, `audioSeconds`) SELECT `id`, `sessionId`, `role`, `kind`, `text`, `transcript`, `audioPath`, `createdAt`, `audioSeconds` FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `messages_session_created` ON `messages` (`sessionId`,`createdAt`);