"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";

export type WarehouseWebGLObject = {
  id: string;
  type: string;
  label: string;
  xCm: number;
  zCm: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  rotation: number;
  products: Array<{ available: number; onHand: number; reserved: number }>;
};

type Props = {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  objects: WarehouseWebGLObject[];
  selectedId: string;
  onSelect: (id: string) => void;
};

type CameraState = {
  yaw: number;
  pitch: number;
  distance: number;
  targetX: number;
  targetY: number;
  targetZ: number;
};

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  pan: boolean;
};

type RendererApi = {
  reset: () => void;
  top: () => void;
  focus: () => void;
  pick: (clientX: number, clientY: number) => string | null;
};

type ProgramLocations = {
  program: WebGLProgram;
  position: number;
  normal: number;
  model: WebGLUniformLocation | null;
  viewProjection: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  unlit: WebGLUniformLocation | null;
};

const TYPE_COLORS: Record<string, [number, number, number]> = {
  RACK: [0.54, 0.34, 0.20],
  PALLET: [0.68, 0.45, 0.22],
  COLD_ROOM: [0.34, 0.66, 0.82],
  FREEZER: [0.28, 0.57, 0.76],
  FRIDGE: [0.48, 0.72, 0.82],
  TABLE: [0.50, 0.39, 0.32],
  WALL: [0.36, 0.37, 0.39],
  DOOR: [0.42, 0.25, 0.15],
  RECEIVING: [0.34, 0.62, 0.38],
  DISPATCH: [0.84, 0.53, 0.19],
  CUSTOM: [0.52, 0.49, 0.46],
};

const VERTEX_SHADER = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_viewProjection;
out vec3 v_normal;
void main() {
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
  v_normal = mat3(u_model) * a_normal;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_normal;
uniform vec3 u_color;
uniform float u_unlit;
out vec4 outColor;
void main() {
  float light = u_unlit > 0.5 ? 1.0 : 0.48 + 0.52 * max(dot(normalize(v_normal), normalize(vec3(0.45, 0.9, 0.55))), 0.0);
  outColor = vec4(u_color * light, 1.0);
}`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function vecLength(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z) || 1;
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Float32Array {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let length = vecLength(zx, zy, zz);
  zx /= length; zy /= length; zz /= length;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  length = vecLength(xx, xy, xz);
  xx /= length; xy /= length; xz /= length;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function modelMatrix(tx: number, ty: number, tz: number, sx: number, sy: number, sz: number, degrees: number): Float32Array {
  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Float32Array([
    c * sx, 0, -s * sx, 0,
    0, sy, 0, 0,
    s * sz, 0, c * sz, 0,
    tx, ty, tz, 1,
  ]);
}

function identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("No se pudo crear shader WebGL.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Shader WebGL inválido";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): ProgramLocations {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("No se pudo crear el programa WebGL.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "No se pudo enlazar WebGL.");
  }
  return {
    program,
    position: gl.getAttribLocation(program, "a_position"),
    normal: gl.getAttribLocation(program, "a_normal"),
    model: gl.getUniformLocation(program, "u_model"),
    viewProjection: gl.getUniformLocation(program, "u_viewProjection"),
    color: gl.getUniformLocation(program, "u_color"),
    unlit: gl.getUniformLocation(program, "u_unlit"),
  };
}

function createCubeVertices(): Float32Array {
  const values: number[] = [];
  const faces: Array<{ normal: [number, number, number]; corners: Array<[number, number, number]> }> = [
    { normal: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { normal: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { normal: [1, 0, 0], corners: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { normal: [-1, 0, 0], corners: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, 1, 0], corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, -1, 0], corners: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];
  for (const face of faces) {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const corner = face.corners[index];
      values.push(corner[0], corner[1], corner[2], face.normal[0], face.normal[1], face.normal[2]);
    }
  }
  return new Float32Array(values);
}

function createGridVertices(widthM: number, depthM: number): Float32Array {
  const values: number[] = [];
  const maxDimension = Math.max(widthM, depthM);
  const step = maxDimension > 120 ? 10 : maxDimension > 60 ? 5 : maxDimension > 25 ? 2 : 1;
  const halfW = widthM / 2;
  const halfD = depthM / 2;
  for (let x = -halfW; x <= halfW + 0.001; x += step) {
    values.push(x, 0.01, -halfD, 0, 1, 0, x, 0.01, halfD, 0, 1, 0);
  }
  for (let z = -halfD; z <= halfD + 0.001; z += step) {
    values.push(-halfW, 0.01, z, 0, 1, 0, halfW, 0.01, z, 0, 1, 0);
  }
  return new Float32Array(values);
}

function cameraPosition(camera: CameraState): [number, number, number] {
  const horizontal = camera.distance * Math.cos(camera.pitch);
  return [
    camera.targetX + horizontal * Math.sin(camera.yaw),
    camera.targetY + camera.distance * Math.sin(camera.pitch),
    camera.targetZ + horizontal * Math.cos(camera.yaw),
  ];
}

function objectModel(object: WarehouseWebGLObject, widthM: number, depthM: number): Float32Array {
  const width = Math.max(0.05, object.widthCm / 100);
  const depth = Math.max(0.05, object.depthCm / 100);
  const height = Math.max(0.05, object.heightCm / 100);
  const x = object.xCm / 100 + width / 2 - widthM / 2;
  const z = object.zCm / 100 + depth / 2 - depthM / 2;
  return modelMatrix(x, height / 2, z, width, height, depth, object.rotation);
}

export function WarehouseWebGLViewer({ widthCm, depthCm, heightCm, objects, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef({ widthCm, depthCm, heightCm, objects, selectedId });
  const selectRef = useRef(onSelect);
  const rendererRef = useRef<RendererApi | null>(null);
  const cameraRef = useRef<CameraState>({ yaw: -0.78, pitch: 0.58, distance: 20, targetX: 0, targetY: 1.5, targetZ: 0 });
  const dragRef = useRef<DragState | null>(null);
  const [error, setError] = useState("");

  sceneRef.current = { widthCm, depthCm, heightCm, objects, selectedId };
  selectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) {
      setError("Este navegador o dispositivo no tiene WebGL2 disponible.");
      return;
    }

    let locations: ProgramLocations;
    try {
      locations = createProgram(gl);
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "No se pudo iniciar WebGL2.");
      return;
    }

    const vao = gl.createVertexArray();
    const cubeBuffer = gl.createBuffer();
    const gridBuffer = gl.createBuffer();
    if (!vao || !cubeBuffer || !gridBuffer) {
      setError("No se pudieron reservar recursos WebGL.");
      return;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, createCubeVertices(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const scene = sceneRef.current;
    const maxDimension = Math.max(scene.widthCm, scene.depthCm, scene.heightCm) / 100;
    cameraRef.current = {
      yaw: -0.78,
      pitch: 0.58,
      distance: Math.max(8, maxDimension * 1.45),
      targetX: 0,
      targetY: Math.min(scene.heightCm / 300, 2.5),
      targetZ: 0,
    };

    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const displayWidth = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const displayHeight = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function viewProjection(): Float32Array {
      const current = sceneRef.current;
      const currentCamera = cameraRef.current;
      const eye = cameraPosition(currentCamera);
      const view = lookAt(eye, [currentCamera.targetX, currentCamera.targetY, currentCamera.targetZ], [0, 1, 0]);
      const maxM = Math.max(current.widthCm, current.depthCm, current.heightCm) / 100;
      const projection = perspective(Math.PI / 4, canvas.width / Math.max(1, canvas.height), 0.05, Math.max(500, maxM * 12));
      return multiply(projection, view);
    }

    function bindBuffer(buffer: WebGLBuffer): void {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(locations.normal);
      gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 24, 12);
    }

    function drawBox(model: Float32Array, color: [number, number, number], unlit = false): void {
      gl.uniformMatrix4fv(locations.model, false, model);
      gl.uniform3f(locations.color, color[0], color[1], color[2]);
      gl.uniform1f(locations.unlit, unlit ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    function render(picking = false): void {
      resize();
      const current = sceneRef.current;
      const widthM = current.widthCm / 100;
      const depthM = current.depthCm / 100;
      const heightM = current.heightCm / 100;
      gl.clearColor(picking ? 0 : 0.91, picking ? 0 : 0.93, picking ? 0 : 0.94, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(locations.program);
      gl.uniformMatrix4fv(locations.viewProjection, false, viewProjection());

      bindBuffer(cubeBuffer);
      if (!picking) {
        drawBox(modelMatrix(0, -0.03, 0, widthM, 0.06, depthM, 0), [0.72, 0.70, 0.67]);
      }

      current.objects.forEach((object, index) => {
        let color = TYPE_COLORS[object.type] ?? TYPE_COLORS.CUSTOM;
        if (picking) {
          const encoded = index + 1;
          color = [(encoded & 255) / 255, ((encoded >> 8) & 255) / 255, ((encoded >> 16) & 255) / 255];
        } else if (object.id === current.selectedId) {
          color = [0.78, 0.18, 0.13];
        }
        drawBox(objectModel(object, widthM, depthM), color, picking);

        if (!picking && object.products.length > 0) {
          const available = object.products.reduce((sum, product) => sum + product.available, 0);
          const markerColor: [number, number, number] = available > 0 ? [0.18, 0.68, 0.31] : [0.82, 0.19, 0.13];
          const width = object.widthCm / 100;
          const depth = object.depthCm / 100;
          const x = object.xCm / 100 + width / 2 - widthM / 2;
          const z = object.zCm / 100 + depth / 2 - depthM / 2;
          const y = object.heightCm / 100 + Math.max(0.12, heightM * 0.018);
          drawBox(modelMatrix(x, y, z, 0.18, 0.18, 0.18, 0), markerColor, true);
        }
      });

      if (!picking) {
        const grid = createGridVertices(widthM, depthM);
        bindBuffer(gridBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, grid, gl.DYNAMIC_DRAW);
        gl.uniformMatrix4fv(locations.model, false, identity());
        gl.uniform3f(locations.color, 0.36, 0.35, 0.34);
        gl.uniform1f(locations.unlit, 1);
        gl.drawArrays(gl.LINES, 0, grid.length / 6);
      }

      gl.bindVertexArray(null);
    }

    function resetCamera(): void {
      const current = sceneRef.current;
      const maxM = Math.max(current.widthCm, current.depthCm, current.heightCm) / 100;
      cameraRef.current = {
        yaw: -0.78,
        pitch: 0.58,
        distance: Math.max(8, maxM * 1.45),
        targetX: 0,
        targetY: Math.min(current.heightCm / 300, 2.5),
        targetZ: 0,
      };
    }

    rendererRef.current = {
      reset: resetCamera,
      top: () => {
        const current = sceneRef.current;
        const maxM = Math.max(current.widthCm, current.depthCm) / 100;
        cameraRef.current = { yaw: 0, pitch: 1.48, distance: Math.max(8, maxM * 1.35), targetX: 0, targetY: 0, targetZ: 0 };
      },
      focus: () => {
        const current = sceneRef.current;
        const selected = current.objects.find((object) => object.id === current.selectedId);
        if (!selected) {
          resetCamera();
          return;
        }
        const widthM = current.widthCm / 100;
        const depthM = current.depthCm / 100;
        cameraRef.current.targetX = selected.xCm / 100 + selected.widthCm / 200 - widthM / 2;
        cameraRef.current.targetY = selected.heightCm / 250;
        cameraRef.current.targetZ = selected.zCm / 100 + selected.depthCm / 200 - depthM / 2;
        cameraRef.current.distance = Math.max(4, Math.max(selected.widthCm, selected.depthCm, selected.heightCm) / 100 * 4);
      },
      pick: (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        render(true);
        const dprX = canvas.width / rect.width;
        const dprY = canvas.height / rect.height;
        const x = Math.round((clientX - rect.left) * dprX);
        const y = Math.round((rect.bottom - clientY) * dprY);
        const pixel = new Uint8Array(4);
        gl.readPixels(clamp(x, 0, canvas.width - 1), clamp(y, 0, canvas.height - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const encoded = pixel[0] + (pixel[1] << 8) + (pixel[2] << 16);
        render(false);
        return encoded > 0 ? sceneRef.current.objects[encoded - 1]?.id ?? null : null;
      },
    };

    let frame = 0;
    const loop = () => {
      render(false);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frame);
      rendererRef.current = null;
      gl.deleteBuffer(cubeBuffer);
      gl.deleteBuffer(gridBuffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(locations.program);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      pan: event.shiftKey || event.button === 1 || event.button === 2,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;

    const camera = cameraRef.current;
    if (drag.pan) {
      const scale = camera.distance * 0.0016;
      const rightX = Math.cos(camera.yaw);
      const rightZ = -Math.sin(camera.yaw);
      const forwardX = -Math.sin(camera.yaw);
      const forwardZ = -Math.cos(camera.yaw);
      camera.targetX += (-dx * rightX + dy * forwardX) * scale;
      camera.targetZ += (-dx * rightZ + dy * forwardZ) * scale;
    } else {
      camera.yaw -= dx * 0.008;
      camera.pitch = clamp(camera.pitch - dy * 0.006, 0.12, 1.49);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      const id = rendererRef.current?.pick(event.clientX, event.clientY);
      if (id) selectRef.current(id);
    }
    dragRef.current = null;
  }

  function onWheel(event: WheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const scene = sceneRef.current;
    const maxM = Math.max(scene.widthCm, scene.depthCm, scene.heightCm) / 100;
    const camera = cameraRef.current;
    camera.distance = clamp(camera.distance * Math.exp(event.deltaY * 0.0012), 2, Math.max(30, maxM * 6));
  }

  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const available = selected?.products.reduce((sum, product) => sum + product.available, 0) ?? 0;

  return (
    <div className="warehouse-webgl-shell">
      <div className="warehouse-webgl-toolbar">
        <div>
          <strong>Visor WebGL 3D</strong>
          <span>Arrastra para rotar · Shift + arrastre para mover · rueda para zoom · clic para seleccionar</span>
        </div>
        <div className="warehouse-webgl-actions">
          <button type="button" onClick={() => rendererRef.current?.reset()}>Perspectiva</button>
          <button type="button" onClick={() => rendererRef.current?.top()}>Superior</button>
          <button type="button" onClick={() => rendererRef.current?.focus()}>Centrar selección</button>
        </div>
      </div>
      <div className="warehouse-webgl-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="warehouse-webgl-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; }}
          onWheel={onWheel}
          onContextMenu={(event) => event.preventDefault()}
        />
        {error && <div className="warehouse-webgl-error">{error}</div>}
        {objects.length === 0 && !error && <div className="warehouse-webgl-empty">Agrega objetos desde la vista Planta para visualizarlos en 3D.</div>}
        {selected && (
          <div className="warehouse-webgl-selection">
            <span>Seleccionado</span>
            <strong>{selected.label}</strong>
            <small>{selected.products.length} producto(s) · {available} disponibles</small>
          </div>
        )}
        <div className="warehouse-webgl-legend">
          <span><i className="is-stock" /> Con stock</span>
          <span><i className="is-empty" /> Sin disponible</span>
        </div>
      </div>
    </div>
  );
}
