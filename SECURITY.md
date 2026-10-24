# Security policy

## Reporting a vulnerability

Please report a security problem privately through GitHub: **Security**, **Report a vulnerability**
(<https://github.com/glockpete/ha-jma-card/security/advisories/new>). Do not open a public issue for it.

You can expect a first answer within a week. The card runs in your browser and reads only what Home Assistant gives
it: entity states and attributes. The most useful reports are about a way a crafted state or attribute (or a crafted
tile or strike file from an upstream server) could inject markup or script into the page, or make the card send your
home location somewhere it should not go.

## Supported versions

Only the latest release receives fixes.
