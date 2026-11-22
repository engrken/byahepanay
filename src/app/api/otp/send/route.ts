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
  if(!isTwilioVerifyConfigured())return jsonError('SMS verification is not configured yet. Add the Twilio Verify credentials in Vercel.',503,'OTP_PROVIDER_NOT_CONFIGURED');
  const sql=getDb();if(!sql)return jsonError('Reporting database is unavailable.',503,'DATABASE_UNAVAILABLE');
  let body:{phoneNumber?:unknown};try{body=await request.json();}catch{return jsonError('Invalid JSON request body.');}
  const phone=normalizePhilippineMobileNumber(body.phoneNumber);if(!phone)return jsonError('Enter a valid Philippine mobile number, such as 09XXXXXXXXX or +639XXXXXXXXX.',422,'INVALID_PHONE');
  const phoneHash=hashPhoneNumber(phone);
  try{
    const events=await sql`with locks as (select pg_advisory_xact_lock(hashtextextended(${spotterId},0)),pg_advisory_xact_lock(hashtextextended(${phoneHash},1))),
      counts as (select count(*) filter(where e.spotter_id=${spotterId}::uuid and e.event_type='send' and e.created_at>now()-interval '60 seconds') as session_minute,
        count(*) filter(where e.spotter_id=${spotterId}::uuid and e.event_type='send' and e.created_at>now()-interval '1 hour') as session_hour,
        count(*) filter(where e.phone_hash=${phoneHash} and e.event_type='send' and e.created_at>now()-interval '1 hour') as phone_hour
        from public.phone_verification_events e,locks)
      insert into public.phone_verification_events(spotter_id,phone_hash,event_type,provider_status)
      select ${spotterId}::uuid,${phoneHash},'send','requested' from counts
      where session_minute=0 and session_hour<4 and phone_hour<4 returning id`;
    const eventId=(events[0] as {id:string}|undefined)?.id;
    if(!eventId)return jsonError('OTP rate limit reached. Wait before requesting another code.',429,'OTP_RATE_LIMIT');
    const account=process.env.TWILIO_ACCOUNT_SID!;const auth=process.env.TWILIO_AUTH_TOKEN!;const service=process.env.TWILIO_VERIFY_SERVICE_SID!;
    const form=new URLSearchParams({To:phone,Channel:'sms'});
    const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/Verifications`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${account}:${auth}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),cache:'no-store'});
    const result=await response.json().catch(()=>({})) as {status?:string;message?:string};
    await sql`update public.phone_verification_events set provider_status=${response.ok?(result.status??'pending'):'provider_error'} where id=${eventId}::uuid`;
    if(!response.ok){console.error('Twilio Verify send failed',{status:response.status,message:result.message});return jsonError('The SMS code could not be sent. Check the number or contact the app administrator.',502,'OTP_DELIVERY_FAILED');}
    return NextResponse.json({sent:true,phoneMasked:maskPhoneNumber(phone),expiresInMinutes:10,message:'Verification code sent. It expires in 10 minutes.'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){console.error('OTP send failed',error);return jsonError('Could not request an SMS code. Please try again.',502,'OTP_DELIVERY_FAILED');}
}
