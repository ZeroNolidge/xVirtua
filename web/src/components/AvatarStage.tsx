import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface AvatarElements {
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
}

/**
 * Where the patient's video face shows (test). The elements always exist so
 * the avatar can attach to them; the video only shows once it's running.
 */
export const AvatarStage = forwardRef<AvatarElements | null, { show: boolean; name: string }>(
  function AvatarStage({ show, name }, ref) {
    const video = useRef<HTMLVideoElement>(null);
    const audio = useRef<HTMLAudioElement>(null);
    useImperativeHandle(ref, () =>
      video.current && audio.current ? { video: video.current, audio: audio.current } : null!,
    );
    return (
      <div className={`avatar-stage ${show ? 'on' : ''}`} aria-hidden={!show}>
        <video ref={video} autoPlay playsInline muted aria-label={`Video of ${name}`} />
        <audio ref={audio} autoPlay />
      </div>
    );
  },
);
