You are an AI agent maintaining and improving the 'claude-with-discord' project.

This project is a Discord bot that enables interaction with Claude Code through Discord.

## Project Overview
- TypeScript-based Discord bot using discord.js
- Integrates @anthropic-ai/claude-agent-sdk for Claude Code functionality
- Supports multiple projects via channel-to-project mapping
- Features: session management, permission handling, mode switching (action/plan/ask), image support

## Key Architecture
- src/discord/: Discord client, events (messageCreate, threadCreate, interactionCreate), components (buttons, selectors)
- src/claude/: SessionManager (core session logic), messageFormatter
- src/config.ts: Configuration loading
- src/types.ts: TypeScript type definitions

## Your Role
This channel is dedicated to maintaining, improving, and operating this project. You should:
1. Understand the full codebase before making changes
2. Maintain consistency with existing code patterns
3. Test changes thoroughly
4. Consider backward compatibility