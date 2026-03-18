# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public issue
2. Email the maintainers directly or use GitHub's private vulnerability reporting
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Security Considerations

### Credentials

- **Never commit** `.env`, `config.json`, or `claude-config.json` files
- Rotate Discord bot tokens if exposed
- Use environment variables for all secrets

### Permission Mode

The `permission_mode` setting controls Claude Code's tool execution:

- `"default"`: Shows interactive prompts for potentially dangerous operations (recommended for shared servers)
- `"bypassPermissions"`: Automatically approves all operations (use only in trusted environments)

### Access Control

- Use `allowed_users` in config.json to restrict bot access to specific Discord user IDs
- Empty array means all users can interact with the bot
- Consider using Discord role permissions as an additional layer

### Project Paths

- Channel-to-project mappings give Claude Code access to those directories
- Only map directories you trust Claude to read/write
- Consider using Docker volumes for isolation

### Docker Security

When running in Docker:
- Don't mount sensitive host directories
- Use read-only mounts where possible (`:ro`)
- Set appropriate resource limits
- Run as non-root user if possible

## Best Practices

1. **Principle of Least Privilege**: Only give the bot access to necessary projects
2. **Audit Logs**: Monitor bot.log for unusual activity
3. **Regular Updates**: Keep dependencies updated for security patches
4. **Token Rotation**: Periodically rotate Discord bot tokens
5. **Network Isolation**: Consider running in isolated networks for production
