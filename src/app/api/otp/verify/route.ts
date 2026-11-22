import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { jsonError, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { hashPhoneNumber, isTwilioVerifyConfigured, maskPhoneNumber, normalizePhilippineMobileNumber } from '@/lib/reporter-verification';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:NextRequest){
  if(!isSameOriginRequest(request))return jsonError('Cross-origin requests are not allowed.',403,'CROSS_SITE_REQUEST');
  const spotterId=getSpotterSessionId(request);if(!spotterId)return jsonError('Secure browser session required.',401,'SESSION_REQUIRED');
  if(!isTwilioVerifyConfigured())return jsonError('SMS verification is not configured yet.',503,'OTP_PROVIDER_NOT_CONFIGURED');
  const sql=getDb();if(!sql)return jsonError('Reporting database is unavailable.',503,'DATABASE_UNAVAILABLE');
  let body:{phoneNumber?:unknown;code?:unknown};try{body=await request.json();}catch{return jsonError('Invalid JSON request body.');}
  const phone=normalizePhilippineMobileNumber(body.phoneNumber);const code=typeof body.code==='string'?body.code.trim():'';
  if(!phone||!/^\d{4,10}$/.test(code))return jsonError('Enter the same mobile number and the 4–10 digit code from the SMS.',422,'INVALID_OTP_INPUT');
  const phoneHash=hashPhoneNumber(phone);
  try{
    const recent=await sql`select count(*)::int as attempts from public.phone_verification_events where spotter_id=${spotterId}::uuid and phone_hash=${phoneHash} and event_type='check' and created_at>now()-interval '10 minutes'`;
    if(Number((recent[0] as {attempts:number}|undefined)?.attempts??0)>=5)return jsonError('Too many code attempts. Request a new code later.',429,'OTP_CHECK_RATE_LIMIT');
    const account=process.env.TWILIO_ACCOUNT_SID!;const auth=process.env.TWILIO_AUTH_TOKEN!;const service=process.env.TWILIO_VERIFY_SERVICE_SID!;
    const form=new URLSearchParams({To:phone,Code:code});
    const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/VerificationCheck`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${account}:${auth}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),cache:'no-store'});
    const result=await response.json().catch(()=>({})) as {status?:string;message?:string};
    const approved=response.ok&&result.status==='approved';
    await sql`insert into public.phone_verification_events(spotter_id,phone_hash,event_type,provider_status) values(${spotterId}::uuid,${phoneHash},'check',${approved?'approved':response.ok?(result.status??'pending'):'provider_error'})`;
    if(!approved)return jsonError(response.ok?'That code is not valid or has expired. Request a new code and try again.':'Verification provider is temporarily unavailable.',response.ok?422:502,'OTP_NOT_APPROVED');
    const identityRows=await sql`insert into public.reporter_identities(phone_hash,phone_masked,verified_at) values(${phoneHash},${maskPhoneNumber(phone)},now())
      on conflict(phone_hash) do update set phone_masked=excluded.phone_masked,verified_at=now() returning id`;
    const reporterId=(identityRows[0] as {id:string}|undefined)?.id;
    if(!reporterId)return jsonError('Could not save phone verification.',500);
    const linkRows=await sql`insert into public.spotter_reporter_links(spotter_id,reporter_id) values(${spotterId}::uuid,${reporterId}::uuid)
      on conflict(spotter_id) do update set reporter_id=excluded.reporter_id where public.spotter_reporter_links.reporter_id=excluded.reporter_id returning reporter_id`;
    if(!linkRows.length)return jsonError('This browser session is already linked to a different verified phone. Use that phone or a separate browser profile.',409,'SESSION_ALREADY_VERIFIED');
    return NextResponse.json({verified:true,phoneMasked:maskPhoneNumber(phone),message:'Phone number verified. Your future reports can contribute to verified-phone consensus.'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){console.error('OTP verify failed',error);return jsonError('Could not verify this phone number. Please try again.',502,'OTP_VERIFY_FAILED');}
}
