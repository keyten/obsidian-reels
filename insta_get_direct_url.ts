/** Forked from instagram-url-direct to bypass cors and return caption */
const https = require('https');
const qs = require('qs');

interface Owner {
    username: string;
    full_name: string;
    is_verified: boolean;
    is_private: boolean;
}

interface RequestData {
    owner: Owner;
    edge_media_preview_like: { count: number };
    is_ad: boolean;
    __typename?: string;
    edge_sidecar_to_children?: { edges: Array<{ node: MediaData }> };
    edge_media_to_caption?: { edges: Array<{ node: { text: string } }> };
    is_video?: boolean;
    video_url?: string;
    display_url?: string;
}

interface MediaData {
    is_video: boolean;
    dimensions: { width: number; height: number };
    video_view_count?: number;
    video_url?: string;
    display_url: string;
}

interface PostInfo {
    owner_username: string;
    owner_fullname: string;
    is_verified: boolean;
    is_private: boolean;
    likes: number;
    is_ad: boolean;
}

interface MediaDetails {
    type: string;
    dimensions: { width: number; height: number };
    video_view_count?: number;
    url: string;
    thumbnail?: string;
}

interface OutputData {
    results_number: number;
    thumbnail_url?: string;
    url_list: string[];
    post_info: PostInfo;
    media_details: MediaDetails[];
    caption?: string;
}

function formatPostInfo(requestData: RequestData): PostInfo {
    try{
        return {
            owner_username: requestData.owner.username,
            owner_fullname: requestData.owner.full_name,
            is_verified: requestData.owner.is_verified,
            is_private: requestData.owner.is_private,
            likes: requestData.edge_media_preview_like.count,
            is_ad: requestData.is_ad
        }
    } catch(err){
        throw new Error(`Failed to format post info: ${err.message}`)
    }
}

function formatMediaDetails(mediaData: MediaData): MediaDetails {
    try{
        if(mediaData.is_video){
            return {
                type: "video",
                dimensions: mediaData.dimensions,
                video_view_count: mediaData.video_view_count,
                url: mediaData.video_url,
                thumbnail: mediaData.display_url
            }
        } else {
            return {
                type: "image",
                dimensions: mediaData.dimensions,
                url: mediaData.display_url
            }
        }
    } catch(err){
        throw new Error(`Failed to format media details: ${err.message}`)
    }
}

function getShortcode(url: string): string {
    try{
        let split_url = url.split("/")
        let post_tags = ["p", "reel", "tv"]
        let index_shortcode = split_url.findIndex(item => post_tags.includes(item)) + 1
        let shortcode = split_url[index_shortcode]
        return shortcode
    } catch(err){
        throw new Error(`Failed to obtain shortcode: ${err.message}`)
    }
}

function isSidecar(requestData: RequestData): boolean {
    try{
        return requestData["__typename"] == "XDTGraphSidecar"
    } catch(err){
        throw new Error(`Failed sidecar verification: ${err.message}`)
    }
}

async function instagramRequest(shortcode: string): Promise<RequestData> {
    const BASE_URL = "https://www.instagram.com/graphql/query";
    const INSTAGRAM_DOCUMENT_ID = "8845758582119845";
    let dataBody = qs.stringify({
        'variables': JSON.stringify({
            'shortcode': shortcode,
            'fetch_tagged_user_count': null,
            'hoisted_comment_id': null,
            'hoisted_reply_id': null
        }),
        'doc_id': INSTAGRAM_DOCUMENT_ID 
    });

    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': dataBody.length
            }
        };

        const req = https.request(BASE_URL, options, (res: any) => {
            let data = '';

            res.on('data', (chunk: any) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (!parsedData.data?.xdt_shortcode_media) {
                        return reject(new Error("Only posts/reels supported, check if your link is valid."));
                    }
                    resolve(parsedData.data.xdt_shortcode_media);
                } catch (err) {
                    reject(new Error(`Failed to parse response: ${err.message}`));
                }
            });
        });

        req.on('error', (err: any) => {
            reject(new Error(`Failed instagram request: ${err.message}`));
        });

        req.write(dataBody);
        req.end();
    });
}

function createOutputData(requestData: RequestData): OutputData {
    try{
        let url_list = [], media_details = []
        const IS_SIDECAR = isSidecar(requestData)
        if(IS_SIDECAR){
            //Post with sidecar
            requestData.edge_sidecar_to_children.edges.forEach((media)=>{
                media_details.push(formatMediaDetails(media.node))
                if(media.node.is_video){ //Sidecar video item
                    url_list.push(media.node.video_url)
                } else { //Sidecar image item
                    url_list.push(media.node.display_url)
                }
            });
        } else {
            //Post without sidecar
            media_details.push(formatMediaDetails(requestData as unknown as MediaData))
            if(requestData.is_video){ // Video media
                url_list.push(requestData.video_url)
            } else { //Image media
                url_list.push(requestData.display_url)
            }
        }

        const caption = requestData.edge_media_to_caption?.edges[0]?.node?.text;

        return {
            results_number: url_list.length,
            url_list,
            post_info: formatPostInfo(requestData),
            media_details,
            caption,
        }
    } catch(err){
        throw new Error(`Failed to create output data: ${err.message}`)
    }
}


export const instagramGetUrl = (url_media: string): Promise<OutputData> =>{
    return new Promise(async (resolve,reject) => {
        try {
            const SHORTCODE = getShortcode(url_media)
            const INSTAGRAM_REQUEST = await instagramRequest(SHORTCODE)
            // console.log(INSTAGRAM_REQUEST);
            const OUTPUT_DATA = createOutputData(INSTAGRAM_REQUEST)
            resolve(OUTPUT_DATA)
        } catch(err){
            reject({
                error: err.message
            })
        }
    })
}
