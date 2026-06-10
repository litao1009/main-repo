#!/usr/bin/env python3
"""混元生图封面生成脚本：调用 TextToImageLite API 生成小说封面"""
import argparse
import hashlib
import hmac
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def load_config():
    config_path = Path(__file__).resolve().parent.parent / "config.json"
    if not config_path.exists():
        print(f"错误: 配置文件不存在: {config_path}", file=sys.stderr)
        sys.exit(1)
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def sign_tc3(secret_id, secret_key, service, host, payload, timestamp, date):
    """TC3-HMAC-SHA256 签名"""

    canonical_uri = "/"
    canonical_querystring = ""
    canonical_headers = f"content-type:application/json\nhost:{host}\n"
    signed_headers = "content-type;host"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = (
        f"POST\n{canonical_uri}\n{canonical_querystring}\n"
        f"{canonical_headers}\n{signed_headers}\n{hashed_payload}"
    )

    algorithm = "TC3-HMAC-SHA256"
    credential_scope = f"{date}/{service}/tc3_request"
    hashed_canonical_request = hashlib.sha256(
        canonical_request.encode("utf-8")
    ).hexdigest()
    string_to_sign = (
        f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_canonical_request}"
    )

    def _hmac_sha256(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, service)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(
        secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    authorization = (
        f"{algorithm} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return authorization


def main():
    parser = argparse.ArgumentParser(description="混元生图封面生成")
    parser.add_argument("--prompt", required=True, help="中文封面描述")
    parser.add_argument("--output", required=True, help="输出图片路径，如 ./cover.png")
    parser.add_argument("--negative-prompt", default=None, help="反向提示词")
    parser.add_argument("--region", default="ap-guangzhou", help="地域")
    args = parser.parse_args()

    config = load_config()
    secret_id = config.get("tencent_secret_id")
    secret_key = config.get("tencent_secret_key")
    if not secret_id or not secret_key:
        print("错误: config.json 中缺少 tencent_secret_id 或 tencent_secret_key", file=sys.stderr)
        sys.exit(1)

    resolution = "768:1024"
    body = {
        "Prompt": args.prompt,
        "Resolution": resolution,
        "LogoAdd": 0,
        "RspImgType": "url",
    }
    negative_base = "文字, 字母, 水印, logo, 签名, 字幕, text, watermark, words, letters, signature"
    if args.negative_prompt:
        body["NegativePrompt"] = negative_base + ", " + args.negative_prompt
    else:
        body["NegativePrompt"] = negative_base

    payload = json.dumps(body, ensure_ascii=False)

    service = "aiart"
    host = "aiart.tencentcloudapi.com"
    action = "TextToImageLite"
    version = "2022-12-29"

    now = datetime.now(timezone.utc)
    timestamp = str(int(now.timestamp()))
    date = now.strftime("%Y-%m-%d")
    authorization = sign_tc3(
        secret_id, secret_key, service, host, payload, timestamp, date
    )

    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Version": version,
        "X-TC-Timestamp": timestamp,
        "X-TC-Region": args.region,
    }

    url = f"https://{host}/"
    req = urllib.request.Request(
        url, data=payload.encode("utf-8"), headers=headers, method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"API 请求失败: {e.code}\n{error_body}", file=sys.stderr)
        sys.exit(1)

    if "Response" in result and "Error" in result["Response"]:
        err = result["Response"]["Error"]
        print(f"API 错误: {err.get('Code')} - {err.get('Message')}", file=sys.stderr)
        sys.exit(1)

    image_url = result.get("Response", {}).get("ResultImage")
    if not image_url:
        print(
            f"错误: 未获取到图片URL，响应: {json.dumps(result, ensure_ascii=False)}",
            file=sys.stderr,
        )
        sys.exit(1)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(image_url, str(output_path))

    # 裁剪右下角 AI 水印，保持 3:4 比例
    crop_watermark(str(output_path))

    print(f"封面已生成: {output_path}")


def crop_watermark(path):
    """裁剪右下角水印并保持 768x1024 的 3:4 比例"""
    from PIL import Image

    img = Image.open(path)
    w, h = img.size  # 预期 768x1024

    # 裁剪右下角：底部裁 30px，右侧按 3:4 等比裁
    crop_bottom = 30
    crop_right = int(crop_bottom * 3 / 4)  # 保持 3:4

    cropped = img.crop((0, 0, w - crop_right, h - crop_bottom))
    # 缩放回 768x1024
    final = cropped.resize((w, h), Image.LANCZOS)
    final.save(path)
    print(f"  (水印区域已裁剪: 右{crop_right}px, 底{crop_bottom}px → 缩放回{w}x{h})")


if __name__ == "__main__":
    main()
