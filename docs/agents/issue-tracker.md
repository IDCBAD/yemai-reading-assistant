# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues:

- Repository: `IDCBAD/yemai-reading-assistant`
- CLI: `gh`
- Pull requests as a request surface: no

## Conventions

- Create: `gh issue create`
- Read: `gh issue view <number> --comments`
- List: `gh issue list`
- Comment: `gh issue comment <number>`
- Add or remove labels: `gh issue edit <number> --add-label/--remove-label`
- Close: `gh issue close <number>`

Run commands inside this repository so `gh` can infer the repository from `origin`. An explicit `--repo IDCBAD/yemai-reading-assistant` may be used when necessary.

## Skill instructions

- When a skill says “publish to the issue tracker,” create a GitHub issue.
- When a skill says “fetch the relevant ticket,” read the GitHub issue and its comments.
- Fully specified implementation work receives the configured `ready-for-agent` label.
- Do not treat pull requests as incoming feature requests or triage items.
