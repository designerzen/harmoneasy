import type { ByteStream } from './types';
import { createByteStream } from './ByteStream';

/**
 * FileLoader - Detects and loads various tracker file formats
 */

export interface TrackerFormat {
  name: string;
  format: number;
}

const TRACKER_FORMATS: TrackerFormat[] = [
  { name: 'Unknown Format', format: 0 },
  { name: 'Ultimate SoundTracker', format: 1 },
  { name: 'D.O.C. SoundTracker 9', format: 2 },
  { name: 'Master SoundTracker', format: 3 },
  { name: 'D.O.C. SoundTracker 2.0/2.2', format: 4 },
  { name: 'SoundTracker 2.3', format: 5 },
  { name: 'SoundTracker 2.4', format: 6 },
  { name: 'NoiseTracker 1.0', format: 7 },
  { name: 'NoiseTracker 1.1', format: 8 },
  { name: 'NoiseTracker 2.0', format: 9 },
  { name: 'ProTracker 1.0', format: 10 },
  { name: 'ProTracker 1.1/2.1', format: 11 },
  { name: 'ProTracker 1.2/2.0', format: 12 },
  { name: "His Master's NoiseTracker", format: 13 },
  { name: 'SoundFX 1.0/1.7', format: 14 },
  { name: 'SoundFX 1.8', format: 15 },
  { name: 'SoundFX 1.945', format: 16 },
  { name: 'SoundFX 1.994/2.0', format: 17 },
  { name: 'BP SoundMon V1', format: 18 },
  { name: 'BP SoundMon V2', format: 19 },
  { name: 'BP SoundMon V3', format: 20 },
  { name: 'Delta Music 1.0', format: 21 },
  { name: 'Delta Music 2.0', format: 22 },
  { name: 'Digital Mugician', format: 23 },
  { name: 'Digital Mugician 7 Voices', format: 24 },
  { name: 'Future Composer 1.0/1.3', format: 25 },
  { name: 'Future Composer 1.4', format: 26 },
  { name: 'SidMon 1.0', format: 27 },
  { name: 'SidMon 2.0', format: 28 },
  { name: 'David Whittaker', format: 29 },
  { name: 'FredEd', format: 30 },
  { name: 'Jochen Hippel', format: 31 },
  { name: 'Jochen Hippel COSO', format: 32 },
  { name: 'Rob Hubbard', format: 33 },
  { name: 'FastTracker II', format: 34 },
  { name: 'Sk@leTracker', format: 35 },
  { name: 'MadTracker 2.0', format: 36 },
  { name: 'MilkyTracker', format: 37 },
  { name: 'DigiBooster Pro 2.18', format: 38 },
  { name: 'OpenMPT', format: 39 },
];

export class FileLoader {
  index: number = 0;
  amiga: any = null;
  player: any = null;
  mixer: any = null;

  constructor(mixer: any = null) {
    this.mixer = mixer;
  }

  get tracker(): TrackerFormat {
    if (this.player) {
      const idx = this.index + this.player.version;
      return TRACKER_FORMATS[idx] || TRACKER_FORMATS[0];
    }
    return TRACKER_FORMATS[0];
  }

  load(stream: ByteStream | ArrayBuffer): any {
    let byteStream: ByteStream;
    if (stream instanceof ArrayBuffer) {
      byteStream = createByteStream(stream);
    } else {
      byteStream = stream;
    }

    let archive: any;
    byteStream.endian = 1;
    byteStream.position = 0;

    // Check for ZIP file
    if (byteStream.readUint() === 67324752) {
      // ZIP magic number
      if (typeof window !== 'undefined' && (window as any).neoart?.Unzip) {
        const ZipFile = (window as any).neoart.ZipFile;
        archive = ZipFile(byteStream);
        byteStream = archive.uncompress(archive.entries[0]);
      } else {
        throw new Error('Unzip support is not available.');
      }
    }

    if (!byteStream) {
      return null;
    }

    // Try FastTracker 2
    if (byteStream.length > 336) {
      byteStream.position = 38;
      const id = byteStream.readString(20);

      if (
        id === 'FastTracker v2.00   ' ||
        id === 'FastTracker v 2.00  ' ||
        id === "Sk@le Tracker" ||
        id === 'MadTracker 2.0' ||
        id === 'MilkyTracker        ' ||
        id === 'DigiBooster Pro 2.18' ||
        id.indexOf('OpenMPT') !== -1
      ) {
        if (typeof window !== 'undefined' && (window as any).neoart?.F2Player) {
          this.player = (window as any).neoart.F2Player(this.mixer);
          this.player.load(byteStream);

          if (this.player.version) {
            this.index = 33; // FASTTRACKER
            return this.player;
          }
        }
      }
    }

    // Try Amiga formats
    byteStream.endian = 0;

    // NoiseTracker/ProTracker M.K.
    if (byteStream.length > 2105) {
      byteStream.position = 1080;
      const id = byteStream.readString(4);

      if (id === 'M.K.' || id === 'FLT4') {
        if (typeof window !== 'undefined' && (window as any).neoart?.MKPlayer) {
          this.player = (window as any).neoart.MKPlayer(this.amiga);
          this.player.load(byteStream);

          if (this.player.version) {
            this.index = 4; // NOISETRACKER
            return this.player;
          }
        }
      } else if (id === 'FEST') {
        if (typeof window !== 'undefined' && (window as any).neoart?.HMPlayer) {
          this.player = (window as any).neoart.HMPlayer(this.amiga);
          this.player.load(byteStream);

          if (this.player.version) {
            this.index = 12; // HISMASTER
            return this.player;
          }
        }
      }
    }

    // ProTracker
    if (byteStream.length > 2105) {
      byteStream.position = 1080;
      const id = byteStream.readString(4);

      if (id === 'M.K.' || id === 'M!K!') {
        if (typeof window !== 'undefined' && (window as any).neoart?.PTPlayer) {
          this.player = (window as any).neoart.PTPlayer(this.amiga);
          this.player.load(byteStream);

          if (this.player.version) {
            this.index = 9; // PROTRACKER
            return this.player;
          }
        }
      }
    }

    byteStream.clear();
    this.index = 0;
    return (this.player = null);
  }
}

export function createFileLoader(mixer: any = null): FileLoader {
  return new FileLoader(mixer);
}
