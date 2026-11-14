import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
import timing from '../timing.json';

export const FPS = 30;
export const DURATION = Math.round(Number(timing.duration) * FPS);

export const CountersignFilm: React.FC = () => (
  <Composition
    id="CountersignFilm"
    component={Film}
    durationInFrames={DURATION}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{}}
  />
);
