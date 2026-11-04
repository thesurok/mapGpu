import type { Vec3 } from "./vec3"
import { degreesToRadians } from "./degrees-to-radians"

function rotateX(p: Vec3, deg: number): Vec3 {
    const rad = degreesToRadians(deg);
    return {
        x: p.x,
        y: p.y * Math.cos(rad) - p.z * Math.sin(rad),
        z: p.y * Math.sin(rad) + p.z * Math.cos(rad)
    }
}

function rotateY(p: Vec3, deg: number): Vec3 {
    const rad = degreesToRadians(deg);
    return {
        x: p.x * Math.cos(rad) + p.z * Math.sin(rad),
        y: p.y,
        z: -p.x * Math.sin(rad) + p.z * Math.cos(rad)
    }
}

function rotateZ(p: Vec3, deg: number): Vec3 {
    const rad = degreesToRadians(deg);
    return {
        x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
        y: p.x * Math.sin(rad) + p.y * Math.cos(rad),
        z: p.z
    }
}

export function rotatePointCloud(pointData: Vec3[], angleX: number, angleY: number, angleZ: number): Vec3[] {
    return pointData.map(p => rotateX(rotateY(rotateZ(p, angleZ), angleY), angleX));
}