import type { ContentBuilderFunction, ContentPageRequest, WebResponse } from "@webhare/router";
import { rawLitty } from "@webhare/litty";
import MarkdownIt from 'markdown-it';


export async function renderMarkdownText(text: string): Promise<string> {
  //FIXME prevent any HTML from leaking through!  maybe some in the future but we still need to Sanitize(Dompurify?) it and/or make it conform to the rtdtype ?
  const md = new MarkdownIt({ linkify: true });
  md.linkify.set({ fuzzyLink: true });
  md.validateLink = (url: string) => true;
  let inList = false;

  //We will shift headings one level down (TODO might want to make this configurable at some point)
  md.renderer.rules["heading_open"] = (tokens, idx) => {
    const level = parseInt(tokens[idx].tag[1]) + 1;
    const tag = level > 6 ? "p" : `h${level}`;
    const className = level > 6 ? "normal" : `heading${level}`;
    return `<${tag} class="${className}">`;
  };
  md.renderer.rules["heading_close"] = (tokens, idx) => {
    const level = parseInt(tokens[idx].tag[1]) + 1;
    const tag = level > 6 ? "p" : `h${level}`;
    return `</${tag}>`;
  };

  //Alternatively we could have modified the token stream, but we don't pass that to others anyway so for now: just modify the output
  md.renderer.rules["bullet_list_open"] = (tokens, idx) => {
    inList = true;
    if (tokens[idx].level === 0) //back to top level
      return `<ul class="unordered">`;
    else
      return `<ul>`;
  };
  md.renderer.rules["bullet_list_close"] = (tokens, idx) => {
    if (tokens[idx].level === 0) //back to top level
      inList = false;
    return `</ul>`;
  };
  md.renderer.rules["list_item_open"] = (tokens, idx) => {
    return '<li>';
  };
  md.renderer.rules["list_item_close"] = (tokens, idx) => {
    return '</li>';
  };
  md.renderer.rules["paragraph_open"] = (tokens, idx) => {
    //we don't want <p> inside lists (but figure out if we now need to generate softbreaks? or is it more robust to just allow parapgrahs in lists anyway? but then markdown users need to update their CSS)
    if (inList)
      return '';
    return `<p class="normal">`;
  };
  md.renderer.rules["paragraph_close"] = (tokens, idx) => {
    if (inList)
      return '';
    return `</p>`;
  };

  const html = md.render(text);
  return html;
}

export async function renderMarkdown(request: ContentPageRequest): Promise<WebResponse> {
  const markdowninfo = await request.getInstance("platform:filetypes.markdown");
  const markdowntext = await markdowninfo?.data?.text?.text();
  const html = markdowntext ? await renderMarkdownText(markdowntext) : "";
  return request.buildWebPage(rawLitty(html));
}

renderMarkdown satisfies ContentBuilderFunction;
