import type {ExampleDialog} from './index.js';
export interface ExampleScene { title:string; start:number; end:number; }
/** Legacy flat pairs remain separate examples; marked scenes retain multi-turn continuity. */
export function exampleScenes(dialogs:readonly ExampleDialog[]):ExampleScene[]{
 const marked=dialogs.some(dialog=>dialog.scene!==undefined);const scenes:ExampleScene[]=[];
 for(let index=0;index<dialogs.length;index+=2){const item=dialogs[index];if(!item)continue;
  if(!marked||item.scene!==undefined||index===0){const previous=scenes.at(-1);if(previous)previous.end=index;scenes.push({title:item.scene??`示例 ${scenes.length+1}`,start:index,end:dialogs.length});}
 }
 return scenes;
}
