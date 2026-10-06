# Pokémon Scrabble

Scrabble de Pokémon para 2 a 4 jugadores, con el estilo y el sistema de sala
de **Pokémon Party** (Carrera de Medallas). Cada palabra tiene que ser uno de
los **1025 Pokémon**.

## Jugar en GitHub Pages

Abre [Pokémon Scrabble](https://terremotoparatodos.github.io/scrabble-pokemon/)
en el navegador. No necesitas instalar nada ni correr un servidor local.

Para jugar desde celulares, crea una sala en la pantalla principal y comparte
el enlace que aparece. Mantén esa pantalla abierta: allí se guarda y se
coordina la partida. Todos los dispositivos necesitan internet; la conexión
entre jugadores usa PeerJS/WebRTC y depende de que la red lo permita.

El sitio se publica desde la raíz de la rama `main` con GitHub Pages. Los
cambios en esa rama se publican automáticamente. `.nojekyll` permite servir
directamente los archivos estáticos, incluidos los modelos y las librerías.

## Cómo jugar

La duración se elige en la configuración: **10 rondas por defecto**, cualquier
cantidad entre 1 y 99, o **0** para jugar hasta vaciar la bolsa. Entre los
compañeros disponibles también está **Umbreon**, con su modelo 3D.

| Forma | Qué hace falta |
| --- | --- |
| **Celulares en la misma Wi-Fi** | Correr el servidor local en la PC y abrir la pantalla principal con la **IP de la PC** (por ejemplo `http://192.168.1.9:8766`). «🌐 Crear sala en línea» muestra el enlace para los celulares. |
| **Varias pestañas en una PC** | Igual: cada pestaña de `control.html` es un jugador distinto. |
| **Una sola pantalla** | Solo la pantalla principal. Con varios jugadores en la misma pantalla, una cortina tapa el atril hasta que el jugador en turno la toca. |

Cada jugador tiene **su posición en la mesa** (Jugadores 1 y 3 a la izquierda,
2 y 4 a la derecha del tablero) y **todos ven el tablero**: en la pantalla
principal y en su celular, que además muestra **solo sus fichas**. Los asientos
pueden ser personas, bots o quedar vacíos.

```bash
python -m http.server 8766
```

La PC necesita internet: PeerJS usa su servidor público para presentar los
dispositivos (los mensajes del juego viajan directo por la Wi-Fi).

## Pantalla completa y cámaras

El juego se juega a **pantalla completa** en el navegador (horizontal). Todo
es parte del área de juego; lo único que va afuera, como en Pokémon Party,
son las **cámaras** de los jugadores.

- **Pantalla principal:** 0, 2, 3 o 4 cámaras (☰ → Cámaras; por defecto,
  tantas como jugadores). 2: una por lado · 3: dos a la izquierda y una a la
  derecha · 4: dos por lado. Interior neutro o **verde croma**. Debajo de
  cada cámara va la placa del jugador (compañero, nombre, puntos, ficha de
  tipo y fichas en el atril); la del jugador en turno se pinta de su color.
  Los jugadores sin cámara tienen su placa en una esquina del área de juego.
  En **1v1**, las dos cámaras están arriba de sus columnas laterales. Debajo
  se agregan tarjetas con los Pokémon creados y los puntos de cada jugada;
  el historial se guarda con la partida y permite desplazarse si hay muchas.
- **Área de juego:** arriba, la barra del turno (quién juega, tipo recomendado,
  ronda y bolsa), el menú ☰, ⟲ (centrar) y ⛶ (pantalla completa).
  Abajo, el atril cuando el jugador en turno juega en esa pantalla.
- **Nada se superpone:** el tablero (2D o 3D) se encuadra solo en el espacio
  libre que dejan la barra, el atril y las placas (en 3D, la cámara busca la
  distancia exacta para que las cuatro esquinas del tablero entren).
  Los avisos y el resultado aparecen dentro del área de juego, nunca sobre
  las cámaras.
- **Menú ☰:** nueva partida, configuración, cómo jugar, vista 2D/3D, vista
  cenital, cámaras, sonidos, sala en línea y la Pokédex de la partida.
  Los efectos acompañan las fichas, las pistas, los cambios, los turnos y la
  Poké Ball; se activan al tocar la página y se pueden silenciar en el menú.
- **Avisos y turnos sin tapar nada:** los avisos breves («Misty se conectó»)
  aparecen dentro de la barra de arriba. El cambio de turno se anima en la
  barra, en la cámara/placa del jugador y, en su pantalla, en el atril (que
  además sube al empezar el turno). En áreas angostas la barra pasa a dos
  filas en vez de recortarse.
- **Página de cada jugador** (`control.html`): igual, sin cámaras. Arriba,
  los puntos y el tipo de todos; abajo, su atril.

## Fichas y mouse

- **Atril:** fichas grandes en la barra de abajo. Se **arrastran al
  tablero**: mientras se arrastra, una ficha «fantasma» queda encajada en la
  casilla donde va a caer (2D y 3D). Arrastrar dentro del atril las
  **reordena**. Una ficha puesta vuelve al atril con un clic o soltándola
  sobre el atril; también se puede mover a otra casilla arrastrándola.
  Siguen valiendo «elegir ficha + clic en la casilla» y el teclado (clic en
  una casilla y escribir; Enter crea el Pokémon).
- **Tablero 3D:** arrastrar un lugar vacío **mueve** el tablero, clic
  derecho (o Ctrl + arrastrar) **gira**, la rueda hace **zoom** y doble clic
  o ⟲ **centra**.

## Vista 3D

La mesa es cuadrada, con **un jugador por lado** (Jugador 1 al sur, 2 al
oeste, 3 al norte y 4 al este), cada uno con su atril, su Pokémon compañero
(modelos de Cobblemon). El nombre y los puntos se muestran en las placas de
las cámaras, sin carteles repetidos sobre los personajes. Alrededor está el
**diorama de Kanto** de Pokémon Party, y en una esquina, la **bolsa**.

- **Vista de jugador:** cada jugador ve el tablero desde su lado, orientado
  hacia él. «🪑 Ver la mesa» (menú) lo sienta en su lugar para mirar a los
  rivales. Los atriles rivales están **boca abajo** (las letras ajenas nunca
  llegan a su pantalla).
- **Fichas de los rivales:** cuando alguien juega, sus fichas vuelan de su
  atril a las casillas (la letra se ve al caer) y roba fichas de la bolsa.
  Si cambia fichas, van a la bolsa y salen otras. Solo se muestra lo
  confirmado.
- **Crear un Pokémon:** el compañero lanza una Poké Ball sobre la palabra,
  se abre con un destello y sale el Pokémon con su nombre y los puntos.
- **Pantalla principal:** vista general de la mesa; si el jugador en turno
  juega ahí, la cámara viaja a su lado.

## Reglas

- **Atril:** 10 fichas de letra y 1 **ficha de tipo**.
- **Ficha de tipo recomendado:** puedes crear cualquier Pokémon. Si coincide
  con el tipo recomendado (cualquiera de sus dos tipos), el puntaje total de
  la jugada da **x2**, incluidos los multiplicadores del tablero y el bonus
  por siete fichas. Sale según cuántos Pokémon hay de cada tipo; ★ Comodín
  (10 %) da x2 a cualquier Pokémon. Después de jugar se roba otra.
- **Palabras:** nombres sin acentos ni signos (`Mr. Mime` → `MRMIME`,
  `Flabébé` → `FLABEBE`, `Ho-Oh` → `HOOH`). En una sola fila o columna, sin
  huecos. La primera pasa por la Poké Ball del centro; las demás se cruzan o
  se unen con fichas del tablero. Si se forman palabras de costado, también
  tienen que ser Pokémon.
- **Cada Pokémon se crea una sola vez** por partida.
- **Puntos:** letras según su frecuencia en los nombres (A=1 … Q/J=10),
  casillas x2/x3 letra y x2/x3 palabra (solo las que se cubren ese turno),
  +20 por usar 7 fichas o más.
- **Regla de oro:** al empezar cada turno, la bolsa garantiza que con las
  fichas del jugador se pueda crear al menos un Pokémon nuevo en el tablero,
  de cualquier tipo. Si no se puede, cambia las fichas justas (vuelven a la
  bolsa). El tipo recomendado no limita las jugadas ni fuerza cambios.
  El atril avisa cuando hubo ajuste. Bots y pistas comparan las jugadas con
  el bonus x2 incluido.
- **Otras acciones:** cambiar fichas y/o la ficha de tipo (usa el turno),
  pasar, o pedir una pista (−5 puntos: muestra un Pokémon posible).
- **Fin:** al terminar las rondas elegidas, al vaciarse la bolsa (se termina
  la ronda), si todos pasan dos veces seguidas o cuando ya no entra ningún
  Pokémon en el tablero.

## Código

| Archivo | Responsabilidad |
| --- | --- |
| `pokedex.js` | Los 1025 Pokémon (nombre en español y tipos), generado desde los CSV de PokeAPI. |
| `rules.js` | Diccionario, fichas, casillas especiales, validación y puntaje (puro, sin DOM). |
| `moves.js` | Búsqueda de jugadas, bots y la regla de oro. |
| `game.js` | Estado de la partida: turnos, bolsa, atriles, fin; `publicView` filtra los atriles ajenos. |
| `board-view.js` | Tablero, fichas, ficha de tipo, tarjetas de jugador (compartido). |
| `play-panel.js` | Atril y botones del turno (compartido pantalla/celular). |
| `setup.js`, `host.js` | Configuración y partida en la pantalla principal (dueña del estado). |
| `net-protocol.js`, `net-host.js`, `control.js` | Sala PeerJS y página del jugador. |
| `view3d/` | Vista 3D (three.js): `stage.js` mesa, luces y diorama (`scenery.js`, `townmodels.js` de Pokémon Party); `board3d.js` une todo; `seats.js` posiciones de la mesa; `racks.js` atriles, bolsa y fichas que vuelan; `mouse.js` mover/girar/zoom y fichas puestas; `tiles.js` fichas; `camera.js` cámara (primera persona y vista general); `companions.js` modelos; `fx.js` Poké Ball; `particles.js` partículas; `textures.js` texturas en canvas. |
| `effects.css`, `hero.js` | Fondo, tarjetas y animaciones de interfaz; Pokémon flotando en la configuración. |
| `audio.js` | Efectos originales sintetizados con Web Audio y control para silenciarlos. |
| `stage.css`, `hud.js`, `cams.js` | Pantalla completa: espacio libre del tablero, menú, pantalla completa; columnas de cámaras y placas. |
| `rack-drag.js` | Arrastrar fichas del atril al tablero y reordenar el atril. |

La pantalla principal es la autoridad: los celulares solo mandan intenciones
y la partida se vuelve a validar ahí. La partida se guarda en `localStorage`
de la pantalla principal (al recargar sigue donde estaba).

Pruebas (reglas, regla de oro y partidas completas de bots):

```bash
npm test
```

Revisión de superposiciones (en el navegador, con una partida abierta):
`await import('./tests/overlap-check.js'); checkOverlaps()` devuelve la lista
de cosas que se pisan (vacía = nada). Se revisó la pantalla principal en
1280×720, 1366×768, 1600×900 y 1920×1080 con 0, 2, 3 y 4 cámaras, con y sin
atril y con un aviso visible, y la página del jugador en 1024×640 a 1920×1080.

## Recursos Pokémon (uso privado)

Proyecto de fans para jugar entre amigos, sin fines comerciales. `assets/sprites/` (sprites de
los 1025) y los datos de `pokedex.js` vienen de [PokeAPI](https://github.com/PokeAPI);
`assets/types/`, `assets/town/` (edificios), `vendor/` (PeerJS y three.js) y
`models/` (modelos de [Cobblemon](https://cobblemon.tools)) se copiaron de
Pokémon Party. Las
imágenes son de Nintendo / Game Freak / The Pokémon Company.

Las tarjetas de **Pokémon creados** usan recursos de
[PMDCollab / SpriteCollab](https://github.com/PMDCollab/SpriteCollab): primera
pose frontal de reposo de 980 Pokémon y retratos Normal de PMD para los 45
que aún no tienen sprite de cuerpo completo. Los archivos se incluyen en
`assets/pmd/` para que carguen directamente desde Pages. Los
[créditos por Pokémon](assets/pmd/credits.html), las fuentes exactas y las
modificaciones están junto a los archivos. Los recursos de la comunidad
conservan su licencia CC BY-NC 4.0; los oficiales corresponden a Chunsoft y
a los titulares de Pokémon.
