import { register } from "@webhare/dompack";
import "./modalitylayer.scss";

// FIXME: calculate from real animation periods
const animation_period_lcm = 6000;

register(".tolliummodalitylayer", elt => {
  for (const loader of elt.getElementsByClassName("tolliummodalitylayer__loader") as HTMLCollectionOf<HTMLElement>)
    loader.addEventListener("animationstart", () => {
      // This is an async event, but because the animation only becomes visible some time after showing the modality layer no-one will see the timing jump
      for (const animation of loader.getAnimations()) {
        if ("animationName" in animation) {
          const delay = -(animation.startTime as number % animation_period_lcm) + "ms";
          loader.style.animationDelay = delay;
        }
      }
    });
});
