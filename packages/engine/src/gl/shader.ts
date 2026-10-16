/** A linked WebGL2 program with chainable uniform setters. Unknown uniforms are ignored, like WebGL does. */
export class Shader {
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly label: string,
    vertex: string,
    fragment: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertex, `${label} (vertex)`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment, `${label} (fragment)`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`shader "${label}" failed to link: ${log}`);
    }
    this.program = program;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  float(name: string, value: number): this {
    this.gl.uniform1f(this.location(name), value);
    return this;
  }

  int(name: string, value: number): this {
    this.gl.uniform1i(this.location(name), value);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.location(name), x, y);
    return this;
  }

  vec3(name: string, value: readonly [number, number, number]): this {
    this.gl.uniform3f(this.location(name), value[0], value[1], value[2]);
    return this;
  }

  vec4(name: string, value: readonly [number, number, number, number]): this {
    this.gl.uniform4f(this.location(name), value[0], value[1], value[2], value[3]);
    return this;
  }

  /** Binds `texture` to texture unit `unit` and points the sampler `name` at it. */
  texture(name: string, unit: number, texture: WebGLTexture): this {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.location(name), unit);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name)!;
  }
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`could not create shader ${label}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader ${label} failed to compile: ${log}`);
  }
  return shader;
}
