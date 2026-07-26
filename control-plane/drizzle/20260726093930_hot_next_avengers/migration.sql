CREATE TABLE `agents` (
	`id` text PRIMARY KEY,
	`organizationId` text NOT NULL,
	`name` text NOT NULL,
	`voice` integer DEFAULT true NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`systemPrompt` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`language` text DEFAULT 'auto' NOT NULL,
	`ttsSpeaker` text DEFAULT 'shubh' NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_agents_organizationId_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `channels` (
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
	CONSTRAINT `channels_default_agent_org_fk` FOREIGN KEY (`organizationId`,`defaultAgentId`) REFERENCES `agents`(`organizationId`,`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `connectors` (
	`agentId` text NOT NULL,
	`slug` text NOT NULL,
	`connectionName` text NOT NULL,
	`allowedActions` text DEFAULT '[]' NOT NULL,
	`credentialEnv` text DEFAULT '{}' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `connectors_pk` PRIMARY KEY(`agentId`, `slug`),
	CONSTRAINT `fk_connectors_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sessionId` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`transcript` text,
	`audioPath` text,
	`createdAt` integer NOT NULL,
	`audioSeconds` integer,
	CONSTRAINT `fk_messages_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sessionId` text NOT NULL,
	`messageId` integer,
	`kind` text NOT NULL,
	`stages` text DEFAULT '[]' NOT NULL,
	`totalMs` integer,
	`startedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_runs_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`channelId` text NOT NULL,
	`peerJid` text NOT NULL,
	`agentId` text,
	`agentPinned` integer DEFAULT false NOT NULL,
	`workdir` text NOT NULL,
	`containerId` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`createdAt` integer NOT NULL,
	`lastActiveAt` integer NOT NULL,
	CONSTRAINT `fk_sessions_channelId_channels_id_fk` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	CONSTRAINT `fk_invitation_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitation_inviter_id_user_id_fk` FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_member_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL UNIQUE,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_org_id` ON `agents` (`organizationId`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channels_org_id` ON `channels` (`organizationId`,`id`);--> statement-breakpoint
CREATE INDEX `messages_session_created` ON `messages` (`sessionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `runs_session_started` ON `runs` (`sessionId`,`startedAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_channel_peer` ON `sessions` (`channelId`,`peerJid`);--> statement-breakpoint
CREATE INDEX `sessions_last_active` ON `sessions` (`lastActiveAt`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);