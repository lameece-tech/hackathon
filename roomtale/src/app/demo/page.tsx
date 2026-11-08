import ClientOnly from "@/components/ClientOnly";

/** The StoryPlayer on a fixed mock story: no camera, no API key, no microphone. */
export default function Demo() {
  return <ClientOnly view="demo" />;
}
