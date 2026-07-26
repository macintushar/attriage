PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_channels` (
	`id` text PRIMARY KEY,
	`organizationId` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`defaultAgentId` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`phone` text,
	`lastError` text,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_channels_organizationId_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_channels_defaultAgentId_agents_id_fk` FOREIGN KEY (`defaultAgentId`) REFERENCES `agents`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_channels`(`id`, `organizationId`, `name`, `kind`, `defaultAgentId`, `status`, `phone`, `lastError`, `createdAt`) SELECT `id`, `organizationId`, `name`, `kind`, `defaultAgentId`, `status`, `phone`, `lastError`, `createdAt` FROM `channels`;--> statement-breakpoint
DROP TABLE `channels`;--> statement-breakpoint
ALTER TABLE `__new_channels` RENAME TO `channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `channels_org_id` ON `channels` (`organizationId`,`id`);