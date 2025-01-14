// @flow

import {vec3, vec4} from 'gl-matrix';
import assert from 'assert';

class Ray {
    pos: vec3;
    dir: vec3;

    constructor(pos_: vec3, dir_: vec3) {
        this.pos = pos_;
        this.dir = dir_;
    }

    intersectsPlane(pt: vec3, normal: vec3, out: vec3): boolean {
        const D = vec3.dot(normal, this.dir);

        // ray is parallel to plane, so it misses
        if (Math.abs(D) < 1e-6) { return false; }

        const t = vec3.dot(vec3.sub(vec3.create(), pt, this.pos), normal) / D;
        const intersection = vec3.scaleAndAdd(vec3.create(), this.pos, this.dir, t);
        vec3.copy(out, intersection);
        return true;
    }

    closestPointOnSphere(center: vec3, r: number, out: vec3): boolean {
        assert(vec3.squaredLength(this.dir) > 0.0 && r >= 0.0);
        if (vec3.equals(this.pos, center) || r === 0.0) {
            out = [0.0, 0.0, 0.0];
            return false;
        }

        const centerToP = vec3.sub([], this.pos, center);
        const a = vec3.dot(this.dir, this.dir);
        const b = 2.0 * vec3.dot(centerToP, this.dir);
        const c = vec3.dot(centerToP, centerToP) - r * r;
        const d = b * b - 4 * a * c;

        if (d < 0.0) {
            // No intersection, find distance between closest points
            vec3.scale(centerToP, centerToP, -1.0);

            const t = Math.max(vec3.dot(centerToP, this.dir), 0.0);
            const pointOnRay = vec3.add([], this.pos, vec3.scale([], this.dir, t));
            const pointToGlobe = vec3.sub([], center, pointOnRay);

            const pointToGlobeLength = vec3.length(pointToGlobe);
            vec3.scale(pointToGlobe, pointToGlobe, 1.0 - r / pointToGlobeLength);
            vec3.sub(out, vec3.add([], pointOnRay, pointToGlobe), center);

            return false;
        } else {
            assert(a > 0.0);
            const t = (-b - Math.sqrt(d)) / (2.0 * a);
            if (t < 0.0) {
                // Ray is pointing away from the sphere
                vec3.scale(out, centerToP, r / vec3.length(centerToP));
                return false;
            } else {
                const dir = vec3.scale([], this.dir, t);
                const pos = vec3.add([], this.pos, dir);

                vec3.sub(out, pos, center);
                return true;
            }
        }
    }
}

class Frustum {
    points: Array<Array<number>>;
    planes: Array<Array<number>>;

    constructor(points_: Array<Array<number>>, planes_: Array<Array<number>>) {
        this.points = points_;
        this.planes = planes_;
    }

    static fromInvProjectionMatrix(invProj: Float64Array, worldSize: number, zoom: number, zInMeters: boolean): Frustum {
        const clipSpaceCorners = [
            [-1, 1, -1, 1],
            [ 1, 1, -1, 1],
            [ 1, -1, -1, 1],
            [-1, -1, -1, 1],
            [-1, 1, 1, 1],
            [ 1, 1, 1, 1],
            [ 1, -1, 1, 1],
            [-1, -1, 1, 1]
        ];

        const scale = Math.pow(2, zoom);

        // Transform frustum corner points from clip space to tile space
        const frustumCoords = clipSpaceCorners
            .map(v => {
                const s = vec4.transformMat4([], v, invProj);
                const k = 1.0 / s[3] / worldSize * scale;
                // Z scale in meters.
                return vec4.mul(s, s, [k, k, zInMeters ? 1.0 / s[3] : k, k]);
            });

        const frustumPlanePointIndices = [
            [0, 1, 2],  // near
            [6, 5, 4],  // far
            [0, 3, 7],  // left
            [2, 1, 5],  // right
            [3, 2, 6],  // bottom
            [0, 4, 5]   // top
        ];

        const frustumPlanes = frustumPlanePointIndices.map((p: Array<number>) => {
            const a = vec3.sub([], frustumCoords[p[0]], frustumCoords[p[1]]);
            const b = vec3.sub([], frustumCoords[p[2]], frustumCoords[p[1]]);
            const n = vec3.normalize([], vec3.cross([], a, b));
            const d = -vec3.dot(n, frustumCoords[p[1]]);
            return n.concat(d);
        });

        return new Frustum(frustumCoords, frustumPlanes);
    }
}

class Aabb {
    min: vec3;
    max: vec3;
    center: vec3;

    constructor(min_: vec3, max_: vec3) {
        this.min = min_;
        this.max = max_;
        this.center = vec3.scale([], vec3.add([], this.min, this.max), 0.5);
    }

    quadrant(index: number): Aabb {
        const split = [(index % 2) === 0, index < 2];
        const qMin = vec3.clone(this.min);
        const qMax = vec3.clone(this.max);
        for (let axis = 0; axis < split.length; axis++) {
            qMin[axis] = split[axis] ? this.min[axis] : this.center[axis];
            qMax[axis] = split[axis] ? this.center[axis] : this.max[axis];
        }
        // Temporarily, elevation is constant, hence quadrant.max.z = this.max.z
        qMax[2] = this.max[2];
        return new Aabb(qMin, qMax);
    }

    distanceX(point: Array<number>): number {
        const pointOnAabb = Math.max(Math.min(this.max[0], point[0]), this.min[0]);
        return pointOnAabb - point[0];
    }

    distanceY(point: Array<number>): number {
        const pointOnAabb = Math.max(Math.min(this.max[1], point[1]), this.min[1]);
        return pointOnAabb - point[1];
    }

    distanceZ(point: Array<number>): number {
        const pointOnAabb = Math.max(Math.min(this.max[2], point[2]), this.min[2]);
        return pointOnAabb - point[2];
    }

    getCorners() {
        const mn = this.min;
        const mx = this.max;
        return [
            [mn[0], mn[1], mn[2]],
            [mx[0], mn[1], mn[2]],
            [mx[0], mx[1], mn[2]],
            [mn[0], mx[1], mn[2]],
            [mn[0], mn[1], mx[2]],
            [mx[0], mn[1], mx[2]],
            [mx[0], mx[1], mx[2]],
            [mn[0], mx[1], mx[2]],
        ];
    }

    // Performs a frustum-aabb intersection test. Returns 0 if there's no intersection,
    // 1 if shapes are intersecting and 2 if the aabb if fully inside the frustum.
    intersects(frustum: Frustum): number {
        // Execute separating axis test between two convex objects to find intersections
        // Each frustum plane together with 3 major axes define the separating axes

        const aabbPoints = this.getCorners();
        let fullyInside = true;

        for (let p = 0; p < frustum.planes.length; p++) {
            const plane = frustum.planes[p];
            let pointsInside = 0;

            for (let i = 0; i < aabbPoints.length; i++) {
                pointsInside += vec3.dot(plane, aabbPoints[i]) + plane[3] >= 0;
            }

            if (pointsInside === 0)
                return 0;

            if (pointsInside !== aabbPoints.length)
                fullyInside = false;
        }

        if (fullyInside)
            return 2;

        for (let axis = 0; axis < 3; axis++) {
            let projMin = Number.MAX_VALUE;
            let projMax = -Number.MAX_VALUE;

            for (let p = 0; p < frustum.points.length; p++) {
                const projectedPoint = frustum.points[p][axis] - this.min[axis];

                projMin = Math.min(projMin, projectedPoint);
                projMax = Math.max(projMax, projectedPoint);
            }

            if (projMax < 0 || projMin > this.max[axis] - this.min[axis])
                return 0;
        }

        return 1;
    }
}
export {
    Aabb,
    Frustum,
    Ray
};
