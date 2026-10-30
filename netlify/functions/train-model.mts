import type { Config } from '@netlify/functions';
import { db,status } from '../../server/db.ts';
import { dataset } from '../../server/dataset.ts';
import { trainModel } from '../../server/model.ts';
export default async()=>{
  const patches=await db()`select patch from drafting.matches where queue=420 group by patch order by max(started_at) desc limit 1`;
  if(!patches.length)return new Response('No dataset');
  const model=trainModel(await dataset({patch:patches[0].patch,platform:'all',queue:420,days:30,tier:'all'}));
  if(!model){await status('model','insufficient_data',{minimum:2500});return new Response('Insufficient data');}
  const version=`logistic-hashed-v1-${Date.now()}`;
  await db().transaction([
    db()`update drafting.models set active=false where context->>'patch'=${model.context.patch}`,
    db()`insert into drafting.models(version,context,artifact,train_end,validation_end,test_end,metrics,active) values(${version},${JSON.stringify(model.context)}::jsonb,${JSON.stringify(model)}::jsonb,${model.trainEnd},${model.calibrationEnd},${model.testEnd},${JSON.stringify(model.metrics)}::jsonb,${model.eligible})`
  ]);
  await status('model',model.eligible?'validated':'validation_failed',model.metrics);return new Response('Evaluated');
};
export const config:Config={schedule:'15 3 * * 1'};
