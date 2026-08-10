/**
 * particles.js — particle movement engine.
 *
 * "flow" preserves the original noise-field motion exactly at default values.
 * The additional boid modes reuse the same particle pool and confinement model
 * while adding lightweight steering rules that remain practical at high counts.
 */
import { engine } from "./config.js";
import { SimplexNoise } from "./noise.js";

const { DT, PARTICLE_POOL } = engine;
const FLOCK_NEIGHBOR_OFFSETS = Object.freeze([1, 7, 31, 127]);
const MORPH_TYPES = Object.freeze(["flow", "flock", "swarm", "vortex", "orbit"]);
const MORPH_SECONDS_PER_TYPE = 4;
const MORPH_ACCEL_A = new Float64Array(3);
const MORPH_ACCEL_B = new Float64Array(3);

function writeModeAcceleration(
  output,
  type,
  index,
  pool,
  activeCount,
  x,
  y,
  z,
  velocityX,
  velocityY,
  velocityZ,
  movementTime,
  sphereBoundary,
  movement,
  noiseX,
  noiseY,
  noiseZ
) {
  let ax = noiseX;
  let ay = noiseY;
  let az = noiseZ;

  if (type === "flock" && activeCount > 1) {
    let averageX = 0;
    let averageY = 0;
    let averageZ = 0;
    let averageVelocityX = 0;
    let averageVelocityY = 0;
    let averageVelocityZ = 0;
    let separationX = 0;
    let separationY = 0;
    let separationZ = 0;
    let samples = 0;

    const separationRadius = Math.max(0.05, sphereBoundary * 0.34);
    const separationRadiusSquared = separationRadius * separationRadius;

    for (const offset of FLOCK_NEIGHBOR_OFFSETS) {
      const neighborIndex = (index + offset) % activeCount;
      if (neighborIndex === index) continue;
      const neighbor = pool[neighborIndex];
      averageX += neighbor.positionX;
      averageY += neighbor.positionY;
      averageZ += neighbor.positionZ;
      averageVelocityX += neighbor.velocityX;
      averageVelocityY += neighbor.velocityY;
      averageVelocityZ += neighbor.velocityZ;
      samples += 1;

      const dx = x - neighbor.positionX;
      const dy = y - neighbor.positionY;
      const dz = z - neighbor.positionZ;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared > 1e-6 && distanceSquared < separationRadiusSquared) {
        const inverse = 1 / distanceSquared;
        separationX += dx * inverse;
        separationY += dy * inverse;
        separationZ += dz * inverse;
      }
    }

    if (samples > 0) {
      const inverseSamples = 1 / samples;
      averageX *= inverseSamples;
      averageY *= inverseSamples;
      averageZ *= inverseSamples;
      averageVelocityX *= inverseSamples;
      averageVelocityY *= inverseSamples;
      averageVelocityZ *= inverseSamples;

      ax =
        noiseX * 0.32 +
        (averageVelocityX - velocityX) * movement.alignment * 0.72 +
        (averageX - x) * movement.cohesion * 0.62 +
        separationX * movement.separation * 0.12;
      ay =
        noiseY * 0.32 +
        (averageVelocityY - velocityY) * movement.alignment * 0.72 +
        (averageY - y) * movement.cohesion * 0.62 +
        separationY * movement.separation * 0.12;
      az =
        noiseZ * 0.32 +
        (averageVelocityZ - velocityZ) * movement.alignment * 0.72 +
        (averageZ - z) * movement.cohesion * 0.62 +
        separationZ * movement.separation * 0.12;
    }
  } else if (type === "swarm") {
    const targetRadius = sphereBoundary * 0.48;
    const targetX = Math.sin(movementTime * 0.83) * targetRadius;
    const targetY = Math.sin(movementTime * 0.57 + 1.7) * targetRadius * 0.62;
    const targetZ = Math.cos(movementTime * 0.71) * targetRadius;
    const radius = Math.sqrt(x * x + y * y + z * z);
    const inverseRadius = radius > 1e-6 ? 1 / radius : 0;
    const nx = x * inverseRadius;
    const ny = y * inverseRadius;
    const nz = z * inverseRadius;
    const crowding = Math.max(
      0,
      1 - radius / Math.max(sphereBoundary * 0.52, 1e-6)
    );

    ax =
      noiseX * (0.72 + movement.alignment * 0.14) +
      (targetX - x) * movement.cohesion * 0.95 +
      nx * crowding * movement.separation * 0.72;
    ay =
      noiseY * (0.72 + movement.alignment * 0.14) +
      (targetY - y) * movement.cohesion * 0.95 +
      ny * crowding * movement.separation * 0.72;
    az =
      noiseZ * (0.72 + movement.alignment * 0.14) +
      (targetZ - z) * movement.cohesion * 0.95 +
      nz * crowding * movement.separation * 0.72;
  } else if (type === "vortex") {
    const radial = Math.sqrt(x * x + z * z);
    const inverseRadial = radial > 1e-6 ? 1 / radial : 0;
    const tangentX = -z * inverseRadial;
    const tangentZ = x * inverseRadial;
    const innerPush = Math.max(
      0,
      1 - radial / Math.max(sphereBoundary * 0.42, 1e-6)
    );

    ax =
      tangentX * (0.75 + movement.alignment * 1.05) -
      x * movement.cohesion * 0.32 +
      x * innerPush * movement.separation * 0.7 +
      noiseX * 0.24;
    ay =
      Math.sin(movementTime * 1.7 + index * 0.013) *
        (0.18 + movement.alignment * 0.2) -
      y * movement.cohesion * 0.2 +
      noiseY * 0.2;
    az =
      tangentZ * (0.75 + movement.alignment * 1.05) -
      z * movement.cohesion * 0.32 +
      z * innerPush * movement.separation * 0.7 +
      noiseZ * 0.24;
  } else if (type === "orbit") {
    const phase = index * 0.017453292519943295;
    const axisX = Math.sin(phase) * 0.58;
    const axisY = 0.72;
    const axisZ = Math.cos(phase) * 0.58;

    let tangentX = axisY * z - axisZ * y;
    let tangentY = axisZ * x - axisX * z;
    let tangentZ = axisX * y - axisY * x;
    const tangentLength = Math.sqrt(
      tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ
    );
    const inverseTangent = tangentLength > 1e-6 ? 1 / tangentLength : 0;
    tangentX *= inverseTangent;
    tangentY *= inverseTangent;
    tangentZ *= inverseTangent;

    const targetRadius = sphereBoundary * 0.62;
    const positionRadius = Math.sqrt(x * x + y * y + z * z);
    const inversePosition = positionRadius > 1e-6 ? 1 / positionRadius : 0;
    const positionX = x * inversePosition;
    const positionY = y * inversePosition;
    const positionZ = z * inversePosition;
    const radialError = targetRadius - positionRadius;

    ax =
      tangentX * (0.7 + movement.alignment * 0.98) +
      positionX * radialError * movement.cohesion * 0.85 +
      positionX * movement.separation * 0.06 +
      noiseX * 0.18;
    ay =
      tangentY * (0.7 + movement.alignment * 0.98) +
      positionY * radialError * movement.cohesion * 0.85 +
      positionY * movement.separation * 0.06 +
      noiseY * 0.18;
    az =
      tangentZ * (0.7 + movement.alignment * 0.98) +
      positionZ * radialError * movement.cohesion * 0.85 +
      positionZ * movement.separation * 0.06 +
      noiseZ * 0.18;
  }

  output[0] = ax;
  output[1] = ay;
  output[2] = az;
}

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

  update(
    index,
    pool,
    activeCount,
    time,
    amplitude,
    noiseScale,
    sphereBoundary,
    damping,
    movement
  ) {
    const x = this.positionX;
    const y = this.positionY;
    const z = this.positionZ;
    const speed = movement.speed;
    const amount = movement.amount;
    const movementTime = time * speed;

    // Original 4D noise field with axis decorrelation offsets.
    const noiseX = noise.noise4D(
      x * noiseScale,
      y * noiseScale,
      z * noiseScale,
      movementTime
    );
    const noiseY = noise.noise4D(
      (x + 100) * noiseScale,
      (y + 100) * noiseScale,
      (z + 100) * noiseScale,
      movementTime
    );
    const noiseZ = noise.noise4D(
      (x + 200) * noiseScale,
      (y + 200) * noiseScale,
      (z + 200) * noiseScale,
      movementTime
    );

    let ax = noiseX;
    let ay = noiseY;
    let az = noiseZ;

    if (movement.type === "morph") {
      const rawPhase =
        (time * movement.morphSpeed) / MORPH_SECONDS_PER_TYPE;
      const wrappedPhase =
        ((rawPhase % MORPH_TYPES.length) + MORPH_TYPES.length) %
        MORPH_TYPES.length;
      const typeIndex = Math.floor(wrappedPhase);
      const nextTypeIndex = (typeIndex + 1) % MORPH_TYPES.length;
      const linearMix = wrappedPhase - typeIndex;
      const smoothMix = linearMix * linearMix * (3 - 2 * linearMix);

      writeModeAcceleration(
        MORPH_ACCEL_A,
        MORPH_TYPES[typeIndex],
        index,
        pool,
        activeCount,
        x,
        y,
        z,
        this.velocityX,
        this.velocityY,
        this.velocityZ,
        movementTime,
        sphereBoundary,
        movement,
        noiseX,
        noiseY,
        noiseZ
      );
      writeModeAcceleration(
        MORPH_ACCEL_B,
        MORPH_TYPES[nextTypeIndex],
        index,
        pool,
        activeCount,
        x,
        y,
        z,
        this.velocityX,
        this.velocityY,
        this.velocityZ,
        movementTime,
        sphereBoundary,
        movement,
        noiseX,
        noiseY,
        noiseZ
      );

      ax = MORPH_ACCEL_A[0] + (MORPH_ACCEL_B[0] - MORPH_ACCEL_A[0]) * smoothMix;
      ay = MORPH_ACCEL_A[1] + (MORPH_ACCEL_B[1] - MORPH_ACCEL_A[1]) * smoothMix;
      az = MORPH_ACCEL_A[2] + (MORPH_ACCEL_B[2] - MORPH_ACCEL_A[2]) * smoothMix;
    } else if (movement.type === "flock" && activeCount > 1) {
      let averageX = 0;
      let averageY = 0;
      let averageZ = 0;
      let averageVelocityX = 0;
      let averageVelocityY = 0;
      let averageVelocityZ = 0;
      let separationX = 0;
      let separationY = 0;
      let separationZ = 0;
      let samples = 0;

      const separationRadius = Math.max(0.05, sphereBoundary * 0.34);
      const separationRadiusSquared = separationRadius * separationRadius;

      for (const offset of FLOCK_NEIGHBOR_OFFSETS) {
        const neighborIndex = (index + offset) % activeCount;
        if (neighborIndex === index) continue;
        const neighbor = pool[neighborIndex];
        averageX += neighbor.positionX;
        averageY += neighbor.positionY;
        averageZ += neighbor.positionZ;
        averageVelocityX += neighbor.velocityX;
        averageVelocityY += neighbor.velocityY;
        averageVelocityZ += neighbor.velocityZ;
        samples += 1;

        const dx = x - neighbor.positionX;
        const dy = y - neighbor.positionY;
        const dz = z - neighbor.positionZ;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared > 1e-6 && distanceSquared < separationRadiusSquared) {
          const inverse = 1 / distanceSquared;
          separationX += dx * inverse;
          separationY += dy * inverse;
          separationZ += dz * inverse;
        }
      }

      if (samples > 0) {
        const inverseSamples = 1 / samples;
        averageX *= inverseSamples;
        averageY *= inverseSamples;
        averageZ *= inverseSamples;
        averageVelocityX *= inverseSamples;
        averageVelocityY *= inverseSamples;
        averageVelocityZ *= inverseSamples;

        const alignment = movement.alignment;
        const cohesion = movement.cohesion;
        const separation = movement.separation;

        ax =
          noiseX * 0.32 +
          (averageVelocityX - this.velocityX) * alignment * 0.72 +
          (averageX - x) * cohesion * 0.62 +
          separationX * separation * 0.12;
        ay =
          noiseY * 0.32 +
          (averageVelocityY - this.velocityY) * alignment * 0.72 +
          (averageY - y) * cohesion * 0.62 +
          separationY * separation * 0.12;
        az =
          noiseZ * 0.32 +
          (averageVelocityZ - this.velocityZ) * alignment * 0.72 +
          (averageZ - z) * cohesion * 0.62 +
          separationZ * separation * 0.12;
      }
    } else if (movement.type === "swarm") {
      const targetRadius = sphereBoundary * 0.48;
      const targetX = Math.sin(movementTime * 0.83) * targetRadius;
      const targetY = Math.sin(movementTime * 0.57 + 1.7) * targetRadius * 0.62;
      const targetZ = Math.cos(movementTime * 0.71) * targetRadius;
      const radius = Math.sqrt(x * x + y * y + z * z);
      const inverseRadius = radius > 1e-6 ? 1 / radius : 0;
      const nx = x * inverseRadius;
      const ny = y * inverseRadius;
      const nz = z * inverseRadius;
      const crowding = Math.max(0, 1 - radius / Math.max(sphereBoundary * 0.52, 1e-6));

      ax =
        noiseX * (0.72 + movement.alignment * 0.14) +
        (targetX - x) * movement.cohesion * 0.95 +
        nx * crowding * movement.separation * 0.72;
      ay =
        noiseY * (0.72 + movement.alignment * 0.14) +
        (targetY - y) * movement.cohesion * 0.95 +
        ny * crowding * movement.separation * 0.72;
      az =
        noiseZ * (0.72 + movement.alignment * 0.14) +
        (targetZ - z) * movement.cohesion * 0.95 +
        nz * crowding * movement.separation * 0.72;
    } else if (movement.type === "vortex") {
      const radial = Math.sqrt(x * x + z * z);
      const inverseRadial = radial > 1e-6 ? 1 / radial : 0;
      const tangentX = -z * inverseRadial;
      const tangentZ = x * inverseRadial;
      const innerPush = Math.max(
        0,
        1 - radial / Math.max(sphereBoundary * 0.42, 1e-6)
      );

      ax =
        tangentX * (0.75 + movement.alignment * 1.05) -
        x * movement.cohesion * 0.32 +
        x * innerPush * movement.separation * 0.7 +
        noiseX * 0.24;
      ay =
        Math.sin(movementTime * 1.7 + index * 0.013) *
          (0.18 + movement.alignment * 0.2) -
        y * movement.cohesion * 0.2 +
        noiseY * 0.2;
      az =
        tangentZ * (0.75 + movement.alignment * 1.05) -
        z * movement.cohesion * 0.32 +
        z * innerPush * movement.separation * 0.7 +
        noiseZ * 0.24;
    } else if (movement.type === "orbit") {
      const phase = index * 0.017453292519943295;
      const axisX = Math.sin(phase) * 0.58;
      const axisY = 0.72;
      const axisZ = Math.cos(phase) * 0.58;

      // Cross(axis, position) gives a tangential orbital direction.
      let tangentX = axisY * z - axisZ * y;
      let tangentY = axisZ * x - axisX * z;
      let tangentZ = axisX * y - axisY * x;
      const tangentLength = Math.sqrt(
        tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ
      );
      const inverseTangent = tangentLength > 1e-6 ? 1 / tangentLength : 0;
      tangentX *= inverseTangent;
      tangentY *= inverseTangent;
      tangentZ *= inverseTangent;

      const targetRadius = sphereBoundary * 0.62;
      const positionRadius = Math.sqrt(x * x + y * y + z * z);
      const inversePosition = positionRadius > 1e-6 ? 1 / positionRadius : 0;
      const positionX = x * inversePosition;
      const positionY = y * inversePosition;
      const positionZ = z * inversePosition;
      const radialError = targetRadius - positionRadius;

      ax =
        tangentX * (0.7 + movement.alignment * 0.98) +
        positionX * radialError * movement.cohesion * 0.85 +
        positionX * movement.separation * 0.06 +
        noiseX * 0.18;
      ay =
        tangentY * (0.7 + movement.alignment * 0.98) +
        positionY * radialError * movement.cohesion * 0.85 +
        positionY * movement.separation * 0.06 +
        noiseY * 0.18;
      az =
        tangentZ * (0.7 + movement.alignment * 0.98) +
        positionZ * radialError * movement.cohesion * 0.85 +
        positionZ * movement.separation * 0.06 +
        noiseZ * 0.18;
    }

    // At the defaults, Flow uses the original gain expression exactly.
    const gain = DT * (0.25 + amplitude * 1.75) * amount * speed;

    this.velocityX = this.velocityX * damping + ax * gain;
    this.velocityY = this.velocityY * damping + ay * gain;
    this.velocityZ = this.velocityZ * damping + az * gain;

    this.positionX += this.velocityX * DT * speed;
    this.positionY += this.velocityY * DT * speed;
    this.positionZ += this.velocityZ * DT * speed;

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
