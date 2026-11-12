# EduTrack LMS — instrucciones para Claude Code

Las reglas obligatorias del proyecto están en AGENTS.md y aplican íntegramente:

@AGENTS.md

Recordatorios operativos:
- Node 24 portátil: `export PATH="$PWD/.tools/node-v24.22.2-win-x64:$PATH"` (Bash) antes de `npm`/`npx`.
- Integración solo contra la base desechable `compose.test.yaml` (`edutrack_test`, puerto 55432); nunca contra desarrollo.
- Registrar en `docs/operacion/VERIFICACION.md` solo comandos realmente ejecutados y sus resultados.
