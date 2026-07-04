# Contributing to Scrutoscope

Thank you for considering contributing to Scrutoscope.

## Development Setup

```bash
git clone https://github.com/scrutineerhq/scrutoscope.git
cd scrutoscope
composer install
```

## Code Standards

- PHP: WordPress Coding Standards via PHPCS (`.phpcs.xml.dist`)
- JS: WordPress-compatible jQuery patterns
- CSS: WordPress admin conventions

## Running Checks

```bash
composer lint        # PHPCS
composer lint:fix    # PHPCBF auto-fix
```

## Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run lint checks
5. Submit a pull request

## Reporting Issues

Use [GitHub Issues](https://github.com/scrutineerhq/scrutoscope/issues). Include:

- WordPress version
- PHP version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the GPL-2.0-or-later license.
