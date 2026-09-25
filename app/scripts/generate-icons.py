#!/usr/bin/env python3
"""
一键生成应用图标脚本
用法: python scripts/generate-icons.py [--logo <path>] [--output-dir <path>]

功能：
1. 从 logo.svg 栅格化生成 1024×1024 PNG
2. 派生所有 icon.iconset 尺寸 (16/32/128/256/512 + @2x)
3. 用 iconutil 打包成 .icns
4. 更新 build/icon.icns 和 build/icon.png
"""

import subprocess
import shutil
import sys
import os
import tempfile
import argparse
from pathlib import Path


def run_command(cmd, description=""):
    """执行 shell 命令，失败时抛出异常"""
    if description:
        print(f"→ {description}")
    try:
        result = subprocess.run(cmd, shell=True, check=True, capture_output=False, text=True)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 命令失败: {cmd}")
        raise


def check_tools():
    """验证必需工具可用"""
    tools = ["sips", "iconutil"]
    missing = [t for t in tools if shutil.which(t) is None]
    if missing:
        print(f"❌ 缺少工具: {', '.join(missing)}")
        print("   在 macOS 上请确保已安装 Xcode 命令行工具")
        sys.exit(1)
    print("✓ 工具检查通过")


def generate_icons(logo_path, output_dir):
    """主生成流程"""
    logo_path = Path(logo_path).resolve()
    output_dir = Path(output_dir).resolve()

    # 验证输入
    if not logo_path.exists():
        print(f"❌ logo 文件不存在: {logo_path}")
        sys.exit(1)

    if not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n🎯 从 logo 生成图标")
    print(f"   输入: {logo_path}")
    print(f"   输出: {output_dir}")

    # 创建临时目录
    with tempfile.TemporaryDirectory(prefix="icon-build-") as tmpdir:
        tmpdir = Path(tmpdir)
        iconset_dir = tmpdir / "icon.iconset"
        iconset_dir.mkdir()

        # 1. 编辑 SVG，将宽高改为 1024
        print("\n📐 准备 1024×1024 源文件...")
        svg_temp = tmpdir / "logo-1024.svg"
        with open(logo_path) as f:
            svg_content = f.read()
        svg_content = svg_content.replace('width="512" height="512"', 'width="1024" height="1024"')
        with open(svg_temp, "w") as f:
            f.write(svg_content)

        # 2. 用 sips 栅格化为 PNG
        png_src = tmpdir / "icon_1024.png"
        run_command(
            f'sips -s format png "{svg_temp}" --out "{png_src}" 2>&1 | tail -1',
            "栅格化 SVG → 1024×1024 PNG",
        )

        # 3. 生成所有 iconset 尺寸
        print("\n🔨 生成 iconset...")
        sizes = [16, 32, 128, 256, 512]
        for size in sizes:
            output_file = iconset_dir / f"icon_{size}x{size}.png"
            run_command(
                f'sips -z {size} {size} "{png_src}" --out "{output_file}" > /dev/null',
                f"  icon_{size}x{size}.png",
            )

        # 4. 生成 @2x 变体
        print("  生成 @2x 变体...")
        retina_pairs = [
            (32, "16x16"),
            (64, "32x32"),
            (256, "128x128"),
            (512, "256x256"),
            (1024, "512x512"),
        ]
        for src_size, dest_name in retina_pairs:
            if src_size == 1024:
                # 1024 需要单独生成
                run_command(
                    f'sips -z 1024 1024 "{png_src}" --out "{iconset_dir}/icon_{dest_name}@2x.png" > /dev/null',
                    f"  icon_{dest_name}@2x.png (1024)",
                )
            else:
                src_file = iconset_dir / f"icon_{src_size}x{src_size}.png"
                if src_file.exists():
                    shutil.copy(src_file, iconset_dir / f"icon_{dest_name}@2x.png")
                else:
                    run_command(
                        f'sips -z {src_size} {src_size} "{png_src}" --out "{iconset_dir}/icon_{dest_name}@2x.png" > /dev/null',
                        f"  icon_{dest_name}@2x.png",
                    )

        # 5. 用 iconutil 打包
        print("\n📦 打包 .icns...")
        icns_output = tmpdir / "icon.icns"
        run_command(
            f'iconutil -c icns "{iconset_dir}" -o "{icns_output}"',
            "iconutil -c icns",
        )

        # 6. 复制到输出目录
        print("\n✅ 写入输出文件...")
        shutil.copy(icns_output, output_dir / "icon.icns")
        print(f"  → {output_dir}/icon.icns ({(output_dir / 'icon.icns').stat().st_size / 1024:.1f} KB)")

        shutil.copy(iconset_dir / "icon_512x512.png", output_dir / "icon.png")
        print(f"  → {output_dir}/icon.png ({(output_dir / 'icon.png').stat().st_size / 1024:.1f} KB)")

    print("\n🎉 图标生成成功！")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logo", default="logo.svg", help="logo.svg 路径 (默认: logo.svg)")
    parser.add_argument(
        "--output-dir", default="build", help="输出目录 (默认: build/)"
    )
    args = parser.parse_args()

    try:
        check_tools()
        generate_icons(args.logo, args.output_dir)
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
