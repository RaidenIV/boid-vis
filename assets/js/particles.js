/**
 * particles.js — the noise-driven particle swarm.
 * Motion comes from a coherent 4D noise field rather than particle-to-particle
 * interaction, identical to the original build. Only the pool allocation and
 * the tunable constants moved out into state.
 */
import { engine } from "./config.js";
import { SimplexNoise } from "./noise.js";

const { DT, PARTICLE_POOL } = engine;

export const noise = new SimplexNoise(Math.random());

export class Particle {
  constructor(sphereBoundary = 1.0) {
    this.positionX = 0;
    this.positionY = 0;
    this.positionZ = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.velocityZ = 0;
    this.colorR = 1;
    this.colorG = 1;
    this.colorB = 1;
    this.reset(sphereBoundary);
  }

  reset(sphereBoundary = 1.0) {
    // Uniform distribution through the sphere volume (cube root of random).
    const radius = Math.cbrt(Math.random()) * sphereBoundary;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);

    this.positionX = radius * Math.sin(phi) * Math.cos(theta);
    this.positionY = radius * Math.sin(phi) * Math.sin(theta);
    this.positionZ = radius * Math.cos(phi);

    this.velocityX = 0;
    this.velocityY = 0;
    this.velocityZ = 0;
  }

  update(time, amplitude, noiseScale, sphereBoundary, damping) {
    const x = this.positionX;
    const y = this.positionY;
    const z = this.positionZ;

    // 4D noise acceleration with axis decorrelation offsets.
    const ax = noise.noise4D(x * noiseScale, y * noiseScale, z * noiseScale, time);
    const ay = noise.noise4D(
      (x + 100) * noiseScale,
      (y + 100) * noiseScale,
      (z + 100) * noiseScale,
      time
    );
    const az = noise.noise4D(
      (x + 200) * noiseScale,
      (y + 200) * noiseScale,
      (z + 200) * noiseScale,
      time
    );

    // Audio-scaled gain: 0.25x with no audio, 2.0x at full magnitude.
    const gain = DT * (0.25 + amplitude * 1.75);

    this.velocityX = this.velocityX * damping + ax * gain;
    this.velocityY = this.velocityY * damping + ay * gain;
    this.velocityZ = this.velocityZ * damping + az * gain;

    this.positionX += this.velocityX * DT;
    this.positionY += this.velocityY * DT;
    this.positionZ += this.velocityZ * DT;

    // Elastic reflection off the confinement sphere.
    const distanceSquared =
      this.positionX * this.positionX +
      this.positionY * this.positionY +
      this.positionZ * this.positionZ;
    const distance = Math.sqrt(distanceSquared);

    if (distance > sphereBoundary) {
      const factor = sphereBoundary / distance;
      this.positionX *= factor;
      this.positionY *= factor;
      this.positionZ *= factor;

      const nx = this.positionX / sphereBoundary;
      const ny = this.positionY / sphereBoundary;
      const nz = this.positionZ / sphereBoundary;
      const dot =
        this.velocityX * nx + this.velocityY * ny + this.velocityZ * nz;

      this.velocityX -= 2 * dot * nx;
      this.velocityY -= 2 * dot * ny;
      this.velocityZ -= 2 * dot * nz;
    }
  }
}

export const particles = [];
for (let index = 0; index < PARTICLE_POOL; index += 1) {
  particles.push(new Particle(1.0));
}

/** Re-seed the whole pool — used by Reset and by a sphere-boundary change. */
export function reseedParticles(sphereBoundary) {
  for (let index = 0; index < PARTICLE_POOL; index += 1) {
    particles[index].reset(sphereBoundary);
  }
}
