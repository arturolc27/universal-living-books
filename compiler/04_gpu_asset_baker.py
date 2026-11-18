"""
04_gpu_asset_baker.py — Renderizado local de assets GPU (WebM ligero).

Convierte escenas Manim o clips de video a WebM con canal alfa usando FFmpeg,
optimizados para reproduccion fluida en el navegador (GpuMediaStage).

Uso:
    python 04_gpu_asset_baker.py --input escena.mp4 --out assets/memory.webm
    python 04_gpu_asset_baker.py --manim escena.py --scene MemoryScene --out assets/
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


FFMPEG_BIN = shutil.which("ffmpeg") or "ffmpeg"


def bake_webm_alpha(input_path: Path, output_path: Path, crf: int = 30) -> None:
    """Transcodifica un video a WebM VP9 con alfa y bitrate optimizado."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        FFMPEG_BIN,
        "-y",
        "-i",
        str(input_path),
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-crf",
        str(crf),
        "-b:v",
        "0",
        "-an",
        str(output_path),
    ]
    subprocess.run(command, check=True)
    print(f"[04_gpu_asset_baker] WebM alfa generado: {output_path}")


def render_manim(scene_file: Path, scene_name: str, output_dir: Path) -> Path:
    """Renderiza una escena Manim a MP4 y devuelve la ruta del archivo."""
    subprocess.run(
        ["manim", "-ql", "--format=mp4", str(scene_file), scene_name],
        check=True,
    )
    media_dir = Path("media/videos") / scene_file.stem / "480p15"
    candidates = list(media_dir.glob(f"{scene_name}.mp4"))
    if not candidates:
        raise FileNotFoundError(f"No se encontro el render de {scene_name} en {media_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{scene_name}.mp4"
    shutil.copy(candidates[0], target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Bake de assets GPU a WebM ligero.")
    parser.add_argument("--input", help="Video de entrada (mp4/mov).")
    parser.add_argument("--manim", help="Archivo de escena Manim (.py).")
    parser.add_argument("--scene", help="Nombre de la escena Manim.")
    parser.add_argument("--out", required=True, help="Ruta de salida (.webm o directorio).")
    parser.add_argument("--crf", type=int, default=30, help="Calidad VP9 (menor = mejor).")
    args = parser.parse_args()

    out_path = Path(args.out)

    if args.manim:
        if not args.scene:
            raise SystemExit("Se requiere --scene cuando se usa --manim.")
        output_dir = out_path if out_path.suffix == "" else out_path.parent
        mp4 = render_manim(Path(args.manim), args.scene, output_dir)
        bake_webm_alpha(mp4, output_dir / f"{args.scene}.webm", crf=args.crf)
        return

    if args.input:
        bake_webm_alpha(Path(args.input), out_path, crf=args.crf)
        return

    raise SystemExit("Debes especificar --input o --manim.")


if __name__ == "__main__":
    main()