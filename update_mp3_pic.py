from pathlib import Path
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TPE2, TALB, TCOM, TCON, error
from mutagen.mp3 import MP3
import re

def extract_title_from_filename(filename: str) -> str:
    """
    Extract a clean title from common MP3 filename patterns.
    
    Examples:
      "01 - Imagine.mp3"        → "Imagine"
      "Taylor Swift - Love.mp3" → "Love"
      "Dancing In The Rain.mp3" → "Dancing In The Rain"
    """
    # Remove file extension
    name = Path(filename).stem

    # Pattern: "Number - Title" or "Artist - Title"
    # Match anything before a dash with optional spaces/numbers
    match = re.match(r'^[\d\s]*[-–—]\s*(.+)$', name)
    if match:
        return match.group(1).strip()

    # If no dash pattern, return the whole name
    return name.strip()

def update_mp3_metadata(
    mp3_file,
    artist=None,
    album_artist=None,
    album=None,
    genre=None,
    cover_image=None,
    composer=None,        # TCOM
    auto_title=True
):
    """
    Update MP3 metadata. If auto_title=True, extract title from filename.
    """
    audio = MP3(mp3_file, ID3=ID3)
    try:
        audio.add_tags()
    except error:
        pass

    tags = audio.tags

    # Auto-extract or clear title
    if auto_title:
        title = extract_title_from_filename(mp3_file)
        tags.delall('TIT2')
        tags.add(TIT2(encoding=3, text=title))
        print(f"  → Title: {title}")
    else:
        # Optionally allow manual title (not used here)
        pass

    # Update other metadata if provided
    if artist is not None:
        tags.delall('TPE1')
        tags.add(TPE1(encoding=3, text=artist))

    if album_artist is not None:
        tags.delall('TPE2')
        tags.add(TPE2(encoding=3, text=album_artist))

    if album is not None:
        tags.delall('TALB')
        tags.add(TALB(encoding=3, text=album))

    if composer is not None:  # ← 新增：作曲者
        tags.delall('TCOM')
        tags.add(TCOM(encoding=3, text=composer))

    if genre is not None:
        tags.delall('TCON')
        tags.add(TCON(encoding=3, text=genre))

    # Update cover
    if cover_image:
        with open(cover_image, 'rb') as img:
            img_data = img.read()
        mime = 'image/png' if cover_image.lower().endswith('.png') else 'image/jpeg'
        tags.delall('APIC')
        tags.add(APIC(encoding=3, mime=mime, type=3, desc='Cover', data=img_data))

    audio.save()


def list_mp3_files(folder_path, recursive=False):
    folder = Path(folder_path)
    pattern = "**/*.mp3" if recursive else "*.mp3"
    return list(folder.glob(pattern))


# ==========================
# 🎯 USAGE EXAMPLE
# ==========================
if __name__ == "__main__":

    music_folder = "./"      # 📁 Replace with your folder
    cover_path = "./中东往事.png"   # 🖼️ Your new cover image

    # Global metadata (applies to all files)
    METADATA = {
        "artist": "加州101",
        "album_artist": "加州101",
        "album": "中东往事",
        "composer": "加州101",
        "genre": "pop",
        "cover_image": cover_path
    }

    mp3_files = list_mp3_files(music_folder, recursive=False)
    print(f"Found {len(mp3_files)} MP3 file(s).\n")

    for mp3 in mp3_files:
        print(f"Processing: {mp3.name}")
        update_mp3_metadata(
            str(mp3),
            artist=METADATA["artist"],
            album_artist=METADATA["album_artist"],
            album=METADATA["album"],
            composer=METADATA["composer"],
            genre=METADATA["genre"],
            cover_image=METADATA["cover_image"],
            auto_title=True  # ← This enables title extraction
        )

    print("\n✅ All files updated!")
