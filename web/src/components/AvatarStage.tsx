import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface AvatarElements {
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  /** Body-language clips, over the live face. */
  clip: HTMLVideoElement;
  /** Where his other face connects before taking over (hidden until then). */
  spare: { video: HTMLVideoElement; audio: HTMLAudioElement };
}

/**
 * Where the patient's video face shows (test). The elements always exist so
 * the avatar can attach to them; the stage only shows once it's running.
 * Under the live face: his resting face (poster), in case the video drops.
 */
export const AvatarStage = forwardRef<
  AvatarElements | null,
  { show: boolean; name: string; poster?: string | null }
>(function AvatarStage({ show, name, poster }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const clip = useRef<HTMLVideoElement>(null);
  const video2 = useRef<HTMLVideoElement>(null);
  const audio2 = useRef<HTMLAudioElement>(null);
  useImperativeHandle(ref, () =>
    video.current && audio.current && clip.current && video2.current && audio2.current
      ? {
          video: video.current,
          audio: audio.current,
          clip: clip.current,
          spare: { video: video2.current, audio: audio2.current },
        }
      : null!,
  );
  return (
    <div className={`avatar-stage ${show ? 'on' : ''}`} aria-hidden={!show}>
      {poster && <img className="stage-poster" src={poster} alt="" />}
      <video ref={video} autoPlay playsInline muted aria-label={`Video of ${name}`} />
      <video ref={video2} autoPlay playsInline muted aria-hidden />
      <video ref={clip} className="stage-clip" playsInline muted preload="auto" />
      <audio ref={audio} autoPlay />
      <audio ref={audio2} autoPlay />
    </div>
  );
});
