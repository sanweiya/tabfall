/**
 * A small original riff used as the built-in demo score. AlphaTex keeps the
 * demo dependency-free: no sampled song files ship with the tool.
 */
export const DEMO_TEX = String.raw`\title "Neon Run"
\artist "TabFall Demo"
\album "Original riff"
\tempo 132
\ts 4 4
.
\ro
:8 0.6 0.6 3.6 0.6 5.5 3.6 7.4 5.5 |
:8 (0.6 2.5 3.4) 0.6 (0.6 2.5 3.4) 0.6 3.6 5.5 7.4 |
\rc 2
:4 8.3{pm} 7.4{pm} 5.5{pm} 3.6{pm} |
:8 5.3 7.4 8.5 7.4 5.3 3.4 2.5 0.6 |
:4 (0.6 2.5 3.4 5.3) 0.6 0.6 0.6 |
:16 12.1 10.2 8.3 7.4 5.5 3.6 2.5 0.6 12.1 10.2 8.3 7.4 5.5 3.6 2.5 0.6 |
:4 7.3{b (0 4 8)} 7.3 5.3{sl} 7.3 |
:8 12.2{nh} 10.2 8.3 7.4 5.5 3.6 2.5 0.6 |
\tempo 144
:4 0.6{pm} 0.6{pm} 0.6{pm} 0.6{pm} |
:16 0.6 3.6 5.5 3.6 0.6 3.6 5.5 3.6 7.4 5.5 3.6 0.6 7.4 5.5 3.6 0.6 |
:4 8.3{pm} 8.3 7.4 5.5 |
:2 7.4{b (0 4 8)} 7.4 |
:1 (0.6 2.5 3.4 4.3 5.2 0.1) |
`;
