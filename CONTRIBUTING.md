# Contributing to Claude Code Discord Bot

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all backgrounds and experience levels.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/anthropics/claude-with-discord/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node.js version, OS, etc.)
   - Relevant logs or error messages

### Suggesting Features

1. Check existing issues for similar suggestions
2. Create a new issue with the `enhancement` label
3. Describe the feature and its use case
4. Explain why it would benefit other users

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Run tests and linting (when available)
5. Commit with clear messages: `git commit -m "feat: add new feature"`
6. Push to your fork: `git push origin feature/your-feature-name`
7. Open a Pull Request

## Development Setup

1. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/claude-with-discord.git
cd claude-with-discord
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment:
```bash
cp .env.example .env
cp config.example.json config.json
# Edit files with your credentials
```

4. Run in development mode:
```bash
npm run dev
```

## Code Style

- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Keep functions focused and well-named
- Add comments for complex logic
- Use meaningful variable and function names

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Examples:
```
feat: add voice message support
fix: resolve session timeout issue
docs: update README with setup instructions
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Configuration management
├── types.ts              # TypeScript types
├── discord/              # Discord.js integration
│   ├── client.ts         # Discord client setup
│   ├── events/           # Event handlers
│   └── components/       # Interactive components
├── claude/               # Claude Agent SDK integration
├── mcp/                  # Model Context Protocol
├── services/             # Business logic
└── utils/                # Utilities
```

## Key Files

- `src/claude/sessionManager.ts` - Core session management logic
- `src/discord/events/messageCreate.ts` - Message handling
- `src/config.ts` - Configuration with hot-reload
- `src/types.ts` - Type definitions

## Testing

Currently, the project does not have automated tests. Contributions to add testing infrastructure are welcome!

When testing manually:
1. Test with a real Discord server
2. Verify all interactive components work
3. Test session lifecycle (create, use, end)
4. Check error handling

## Questions?

Feel free to open an issue for any questions about contributing.
