# Deprecated: re-export shims

Every file in this folder is a two-line re-export of the same path under
`src/modules/ai-interview/`, kept so older imports (mostly tests) keep
resolving. There is no logic here. Import from `src/modules/ai-interview/`
in new code.
