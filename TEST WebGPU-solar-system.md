Create a complete HTML code that renders a photo realistic 3D solar system simulation including the Sun, all eight planets, and their major satellites. The simulation should visually represent orbital motion, gravity effects, planetary sizes relative to each other, and realistic distances where possible. Use modern web technologies such as WebGPU to achieve smooth and accurate 3D animation.

Requirements:
- Include the Sun at the center with appropriate scale and glowing effect.
- Represent all eight planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune.
- Include major satellites for planets that have significant moons (e.g., Earth's Moon, Jupiter's Galilean moons, ect).
- Animate the orbital paths so that planets and their moons revolve around their parents in real time or accelerated time to visualize motion clearly.
- Simulate gravitational influence conceptually by maintaining realistic orbital behavior.
- Use relative sizes and distances to maintain visual clarity while balancing realism.
- Use relative distances between objects based on real information while balancing visual clarity.
- Include planet labels.
- Include user controls to rotate, zoom, and pan the camera to explore the solar system.
- Selecting a planet should focus on the planet and show a factoid popup with details about the planet (e.g., diameter, distance from sun, orbital period, temperature range, number of moons, etc).
- Include user controls to adjust time scale with a range of 1 second/second to 1000 days/second, ensure planet and moon movement speeds.
- Include Jump To buttons for the sun and all planets.

# Steps
1. Set up a 3D scene using WebGPU.
2. Create a luminous Sun object at the scene center with light emission.
3. Add planet meshes with textures mapped appropriately.
4. Attach satellite objects to their planets, each revolving around their planet.
5. Implement orbital mechanics to animate the revolution of planets around the Sun and satellites around their planets with accurate time dialation.
6. Add camera controls for user interaction.
7. Optimize performance and appearance (lighting, shadows).

# Output Format
Provide a fully functional and HTML page with css and javascript in seperate files, demonstrating the described 3D solar system. Include comments on all functions with description and function signature. Write functions, variables, ect. in human readable names (no single letter variables) and format (don't try to minify). The javascript *can* be broken into multiple modules based on function purpose to reduce a single large file for developement. Write individual files as soon as they are ready to avoid losing information if this chat context gets compressed.

# Notes
- Use @ripl/3d for WebGPU support, the @ripl/3d, @ripl/web and @ripl/webgpu packages are already installed in the project folder.
- Ripl3d references: https://github.com/andrewcourtice/ripl, https://www.ripl.run/docs/api/@ripl/webgpu/.
- You may include more packages if needed for the project.
- Realistic scale in terms of distance may need to be compressed for better visualization.
- Ensure the simulation runs smoothly on modern browsers without additional plugins.

# Example
// No direct code example due to complexity, but ensure the inclusion of [Scene Setup], [Sun Object], [Planet and Satellite Meshes], [Animation Loop], and [Camera Controls] in your code.


